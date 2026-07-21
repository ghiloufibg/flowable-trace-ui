package io.github.ghiloufibg.flowable.rest;

import io.github.ghiloufibg.flowable.rest.dto.EngineJobDto;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.flowable.bpmn.model.Activity;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.repository.ProcessDefinition;
import org.flowable.job.api.Job;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Backs {@code GET custom/jobs/{id}} - see claudedocs/backend-library-design.md §7.2.
 *
 * <p>{@code lockOwner}/{@code lockExpiresAt} aren't exposed on the public {@code Job}/{@code
 * JobInfo} interfaces (only on internal entity implementations), so this reads {@code LOCK_OWNER_}
 * /{@code LOCK_EXP_TIME_} directly from Flowable's own {@code ACT_RU_JOB}/{@code ACT_RU_TIMER_JOB}
 * tables instead - see {@link #loadLockInfo(String, String)}. Dead-letter jobs have neither column
 * in Flowable's schema at all (a dead-letter job isn't being executed by any worker, so it
 * structurally can't be locked) - {@code null} for them is the honest value, not a gap. Unlike
 * every other enrichment in this codebase, this depends on Flowable's internal schema rather than
 * its public API or flow-trace-ui's own tables - flagged explicitly since a future Flowable upgrade
 * could in principle rename these columns without that counting as a public API break.
 *
 * <p>{@code maxRetries} is parsed from the activity's {@code flowable:failedJobRetryTimeCycle}
 * extension (an ISO8601 repeating-interval string, e.g. {@code "R5/PT5M"}), read directly off the
 * {@link Activity#getFailedJobRetryTimeCycleValue()} on the parsed {@link BpmnModel} - see {@link
 * #loadConfiguredRetries(String, String)}. Confirmed empirically NOT to be readable from the job
 * entity itself at any point in its lifecycle: a freshly-created job's {@code getRetries()} is
 * always Flowable's hardcoded default (3) regardless of any configured cycle - the cycle is only
 * consulted when Flowable reschedules the job *after* its first failure, by which point the
 * original count is gone, mixed into a "remaining, post-decrement" number, not recoverable from job
 * state at all. Falls back to {@link #DEFAULT_MAX_RETRIES} when no cycle is configured (matching
 * Flowable's own default) or the value doesn't parse.
 *
 * <p>{@code exceptionClass} is heuristically parsed from the first line of the stack trace (Java
 * convention: "fully.qualified.Exception: message") since Flowable only exposes the exception
 * message, not the class, on the public API.
 */
@RestController
@RequestMapping("/custom/jobs")
public class JobEnrichmentController {

  private static final int DEFAULT_MAX_RETRIES = 3;

  private final ManagementService managementService;
  private final RepositoryService repositoryService;
  private final RuntimeService runtimeService;
  private final HistoryService historyService;
  private final JdbcTemplate jdbcTemplate;

  public JobEnrichmentController(
      ManagementService managementService,
      RepositoryService repositoryService,
      RuntimeService runtimeService,
      HistoryService historyService,
      ProcessEngine processEngine) {
    this.managementService = managementService;
    this.repositoryService = repositoryService;
    this.runtimeService = runtimeService;
    this.historyService = historyService;
    this.jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
  }

  @GetMapping("/{id}")
  public EngineJobDto getJob(@PathVariable String id) {
    Job timerJob = managementService.createTimerJobQuery().jobId(id).singleResult();
    if (timerJob != null) {
      return toDto(timerJob, "timer", managementService.getTimerJobExceptionStacktrace(id));
    }
    Job deadLetterJob = managementService.createDeadLetterJobQuery().jobId(id).singleResult();
    if (deadLetterJob != null) {
      return toDto(
          deadLetterJob, "deadletter", managementService.getDeadLetterJobExceptionStacktrace(id));
    }
    Job asyncJob = managementService.createJobQuery().jobId(id).singleResult();
    if (asyncJob != null) {
      return toDto(asyncJob, "async", managementService.getJobExceptionStacktrace(id));
    }
    throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Job not found: " + id);
  }

  private EngineJobDto toDto(Job job, String type, String stackTrace) {
    ProcessDefinition definition =
        job.getProcessDefinitionId() != null
            ? repositoryService
                .createProcessDefinitionQuery()
                .processDefinitionId(job.getProcessDefinitionId())
                .singleResult()
            : null;
    LockInfo lock = loadLockInfo(job.getId(), type);

    return new EngineJobDto(
        job.getId(),
        type,
        job.getProcessInstanceId(),
        resolveBusinessKey(job.getProcessInstanceId()),
        definition != null ? definition.getKey() : null,
        definition != null ? definition.getName() : null,
        definition != null ? definition.getVersion() : 0,
        job.getElementId(),
        resolveActivityName(job.getProcessDefinitionId(), job.getElementId()),
        job.getDuedate() != null ? job.getDuedate().toInstant() : null,
        job.getCreateTime() != null ? job.getCreateTime().toInstant() : null,
        job.getRetries(),
        loadConfiguredRetries(job.getProcessDefinitionId(), job.getElementId()),
        extractExceptionClass(stackTrace),
        job.getExceptionMessage(),
        stackTrace,
        lock.owner(),
        lock.expiresAt(),
        loadAttempts(job.getId()));
  }

  private record LockInfo(String owner, Instant expiresAt) {
    private static final LockInfo NONE = new LockInfo(null, null);
  }

  /**
   * Dead-letter jobs have no lock columns in Flowable's schema at all (confirmed empirically) -
   * they're never locked, so {@link LockInfo#NONE} for them is correct, not a fallback.
   */
  private LockInfo loadLockInfo(String jobId, String type) {
    if (type.equals("deadletter")) {
      return LockInfo.NONE;
    }
    String table = type.equals("timer") ? "ACT_RU_TIMER_JOB" : "ACT_RU_JOB";
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT LOCK_OWNER_, LOCK_EXP_TIME_ FROM " + table + " WHERE ID_ = ?", jobId);
    if (rows.isEmpty()) {
      return LockInfo.NONE;
    }
    Map<String, Object> row = rows.get(0);
    String owner = (String) row.get("LOCK_OWNER_");
    Timestamp expiry = (Timestamp) row.get("LOCK_EXP_TIME_");
    return new LockInfo(owner, expiry != null ? expiry.toInstant() : null);
  }

  private int loadConfiguredRetries(String processDefinitionId, String elementId) {
    if (processDefinitionId == null || elementId == null) {
      return DEFAULT_MAX_RETRIES;
    }
    BpmnModel bpmnModel = repositoryService.getBpmnModel(processDefinitionId);
    FlowElement element = bpmnModel != null ? bpmnModel.getFlowElement(elementId) : null;
    if (!(element instanceof Activity activity)) {
      return DEFAULT_MAX_RETRIES;
    }
    return parseRetryCount(activity.getFailedJobRetryTimeCycleValue());
  }

  /**
   * {@code failedJobRetryTimeCycle} is an ISO8601 repeating-interval string, {@code
   * "R{n}/{duration}"} (e.g. {@code "R5/PT5M"}) - {@code n} is the configured retry count. Falls
   * back to {@link #DEFAULT_MAX_RETRIES} for null/unconfigured or unparseable values rather than
   * throwing.
   */
  private static int parseRetryCount(String failedJobRetryTimeCycle) {
    if (failedJobRetryTimeCycle == null || !failedJobRetryTimeCycle.startsWith("R")) {
      return DEFAULT_MAX_RETRIES;
    }
    int slash = failedJobRetryTimeCycle.indexOf('/');
    String countPart =
        slash > 0
            ? failedJobRetryTimeCycle.substring(1, slash)
            : failedJobRetryTimeCycle.substring(1);
    try {
      return Integer.parseInt(countPart);
    } catch (NumberFormatException e) {
      return DEFAULT_MAX_RETRIES;
    }
  }

  private String resolveBusinessKey(String processInstanceId) {
    if (processInstanceId == null) {
      return null;
    }
    var active =
        runtimeService
            .createProcessInstanceQuery()
            .processInstanceId(processInstanceId)
            .singleResult();
    if (active != null) {
      return active.getBusinessKey();
    }
    var historic =
        historyService
            .createHistoricProcessInstanceQuery()
            .processInstanceId(processInstanceId)
            .singleResult();
    return historic != null ? historic.getBusinessKey() : null;
  }

  private String resolveActivityName(String processDefinitionId, String elementId) {
    if (processDefinitionId == null || elementId == null) {
      return null;
    }
    BpmnModel bpmnModel = repositoryService.getBpmnModel(processDefinitionId);
    if (bpmnModel == null) {
      return null;
    }
    FlowElement element = bpmnModel.getFlowElement(elementId);
    return element != null ? element.getName() : null;
  }

  private static String extractExceptionClass(String stackTrace) {
    if (stackTrace == null || stackTrace.isBlank()) {
      return null;
    }
    String firstLine = stackTrace.lines().findFirst().orElse("");
    int colonIndex = firstLine.indexOf(':');
    return colonIndex > 0 ? firstLine.substring(0, colonIndex).trim() : firstLine.trim();
  }

  private List<EngineJobDto.Attempt> loadAttempts(String jobId) {
    return jdbcTemplate.query(
        "SELECT ATTEMPT_AT, OUTCOME, WORKER, EXCEPTION_MESSAGE FROM FLOWTRACE_JOB_ATTEMPT"
            + " WHERE JOB_ID = ? ORDER BY ATTEMPT_AT",
        (rs, rowNum) ->
            new EngineJobDto.Attempt(
                rs.getTimestamp("ATTEMPT_AT").toInstant(),
                null,
                rs.getString("OUTCOME").toLowerCase(java.util.Locale.ROOT),
                rs.getString("WORKER"),
                rs.getString("EXCEPTION_MESSAGE")),
        jobId);
  }
}
