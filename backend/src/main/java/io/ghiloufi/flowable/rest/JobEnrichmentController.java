package io.ghiloufi.flowable.rest;

import io.ghiloufi.flowable.rest.dto.EngineJobDto;
import java.util.List;
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
 * <p>Two fields have no public Flowable API and are handled as documented gaps: {@code lockOwner}
 * /{@code lockExpiresAt} aren't exposed on the public {@code Job}/{@code JobInfo} interfaces (only
 * on internal entity implementations), so both are always null. {@code maxRetries} isn't tracked
 * per-job once retries are decremented, so it falls back to Flowable's documented async-executor
 * default (3) rather than the job's original configured value if that ever differed. {@code
 * exceptionClass} is heuristically parsed from the first line of the stack trace (Java convention:
 * "fully.qualified.Exception: message") since Flowable only exposes the exception message, not the
 * class, on the public API.
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
        DEFAULT_MAX_RETRIES,
        extractExceptionClass(stackTrace),
        job.getExceptionMessage(),
        stackTrace,
        null,
        null,
        loadAttempts(job.getId()));
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
