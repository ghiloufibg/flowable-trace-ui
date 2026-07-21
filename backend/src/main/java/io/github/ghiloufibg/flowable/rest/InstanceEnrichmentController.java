package io.github.ghiloufibg.flowable.rest;

import io.github.ghiloufibg.flowable.audit.AuditRepository;
import io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceDto;
import io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceSummaryDto;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.Process;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ManagementService;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.runtime.Execution;
import org.flowable.identitylink.api.IdentityLinkInfo;
import org.flowable.job.api.Job;
import org.flowable.task.api.Task;
import org.flowable.task.api.TaskInfo;
import org.flowable.task.api.history.HistoricTaskInstance;
import org.flowable.variable.api.history.HistoricVariableInstance;
import org.flowable.variable.api.persistence.entity.VariableInstance;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Backs {@code GET custom/instances/{id}} - see claudedocs/backend-library-design.md §7.2. The most
 * complex enrichment endpoint: assembles the full BPMN graph (structure from {@link BpmnModel},
 * runtime state from {@link RuntimeService}/{@link HistoryService}) plus variables, tasks, trail
 * and jobs. The pure graph-shape logic (node/edge mapping, gateway/multi-instance heuristics) lives
 * in {@link BpmnGraphSupport}; this class owns loading data via the Flowable services and JDBC, and
 * assembling the final DTO.
 *
 * <p>{@code gatewayDecision} and edge {@code taken} are authoritative when {@code
 * FLOWTRACE_SEQUENCE_FLOW_TAKEN} has rows for the instance - populated live by {@code
 * FlowTraceAuditEventListener} from Flowable's {@code SEQUENCEFLOW_TAKEN} engine event, which fires
 * per sequence-flow traversal. See {@link #loadTakenSequenceFlows(String)}. An instance whose
 * entire lifetime happened before that listener was attached has no rows at all for it, in which
 * case both fields fall back to the previous reachable-successor heuristic (both endpoints reached
 * for an edge; first reached successor in BPMN document order for a gateway) rather than reporting
 * a partially-authoritative mix. When authoritative data exists, {@code gatewayDecision} reports
 * the *most recently* taken outgoing flow, correctly handling a gateway revisited by a loop that
 * takes a different branch each time - the case the old heuristic could get wrong. Node types are
 * limited to the frontend's supported {@code BpmnNodeType} union; unsupported BPMN element types
 * (sub-process *container* shapes themselves, intermediate events, non-timer boundary events, etc.)
 * are omitted from {@code nodes[]} rather than mislabeled - {@code trail[]} follows the same rule
 * via {@link BpmnGraphSupport#mapActivityType(String)}: a {@link HistoricActivityInstance} row of
 * an unsupported type (e.g. a sequence-flow-level history entry) is omitted rather than defaulted
 * to a misleading type like {@code "serviceTask"}.
 *
 * <p>{@code multiInstance} counts are derived from {@link HistoricActivityInstance} rows grouped by
 * activity id (one row per loop iteration) rather than execution-tree traversal. For parallel
 * multi-instance this is exact (all iterations' rows exist as soon as the activity starts); for
 * *sequential* multi-instance, {@code total} under-counts the true loop cardinality until the last
 * iteration has started, since rows are created one at a time. Same standard as {@code
 * gatewayDecision}: documented heuristic, not a silent guess.
 *
 * <p>{@code callActivity.childInstanceId} comes directly from {@link
 * HistoricActivityInstance#getCalledProcessInstanceId()}. Populated as soon as the child process
 * instance starts, not only after the call activity completes. A call activity that is itself
 * multi-instance (rare, technically allowed by BPMN) can spawn more than one child instance; since
 * the DTO field is a single string, one is reported (the currently-running one if any, else the
 * most recently started) rather than the full set.
 *
 * <p>Flow elements nested inside a sub-process (including an embedded, {@code triggeredByEvent}
 * event sub-process) ARE walked and included when their own type is otherwise supported - {@link
 * BpmnGraphSupport#collectAllFlowElements} recurses into every {@code FlowElementsContainer} (which
 * {@link Process} and every sub-process type implement) rather than reading only {@code
 * process.getFlowElements()}, which per Flowable's BPMN model API returns just the top-level
 * process's own direct children. Found live: a call activity nested inside an event sub-process
 * (masterclass's {@code refundProcessCallActivity}, inside {@code paymentCallbackEventSubProcess})
 * was silently absent from {@code nodes[]}/{@code edges[]} even though {@link
 * HistoryService}-backed data (the trail) correctly included it, because the two code paths walk
 * the model differently.
 */
@RestController
@RequestMapping("/custom/instances")
public class InstanceEnrichmentController {

  private final RepositoryService repositoryService;
  private final RuntimeService runtimeService;
  private final TaskService taskService;
  private final HistoryService historyService;
  private final ManagementService managementService;
  private final JdbcTemplate jdbcTemplate;

  public InstanceEnrichmentController(
      RepositoryService repositoryService,
      RuntimeService runtimeService,
      TaskService taskService,
      HistoryService historyService,
      ManagementService managementService,
      DataSource dataSource) {
    this.repositoryService = repositoryService;
    this.runtimeService = runtimeService;
    this.taskService = taskService;
    this.historyService = historyService;
    this.managementService = managementService;
    this.jdbcTemplate = new JdbcTemplate(dataSource);
  }

  @GetMapping("/{id}")
  public ProcessInstanceDto getInstance(@PathVariable String id) {
    HistoricProcessInstance historic =
        historyService.createHistoricProcessInstanceQuery().processInstanceId(id).singleResult();
    if (historic == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Process instance not found: " + id);
    }

    boolean active = historic.getEndTime() == null;
    BpmnModel bpmnModel = repositoryService.getBpmnModel(historic.getProcessDefinitionId());
    Process process = bpmnModel.getProcessById(historic.getProcessDefinitionKey());
    // Flattened once and reused below: includes elements nested inside sub-processes (see class
    // Javadoc), not just process.getFlowElements()'s top-level view.
    List<FlowElement> allFlowElements = BpmnGraphSupport.collectAllFlowElements(process);

    Set<String> activeActivityIds =
        active ? new HashSet<>(runtimeService.getActiveActivityIds(id)) : Set.of();
    List<HistoricActivityInstance> historicActivities =
        historyService.createHistoricActivityInstanceQuery().processInstanceId(id).list();
    Set<String> reachedActivityIds =
        historicActivities.stream()
            .map(HistoricActivityInstance::getActivityId)
            .collect(Collectors.toSet());
    reachedActivityIds.addAll(activeActivityIds);

    Map<String, TaskInfo> tasksByActivityId = loadTasksByActivityId(id);
    Map<String, ProcessInstanceDto.JobError> jobErrorsByActivityId =
        loadJobErrorsByActivityId(id, bpmnModel);
    Map<String, Job> timerJobsByActivityId = loadTimerJobsByActivityId(id);
    Map<String, List<HistoricActivityInstance>> historicByActivityId =
        historicActivities.stream()
            .collect(Collectors.groupingBy(HistoricActivityInstance::getActivityId));
    Map<String, Instant> takenSequenceFlows = loadTakenSequenceFlows(id);

    List<ProcessInstanceDto.BpmnNode> nodes =
        BpmnGraphSupport.buildNodes(
            allFlowElements,
            bpmnModel,
            activeActivityIds,
            reachedActivityIds,
            tasksByActivityId,
            jobErrorsByActivityId,
            timerJobsByActivityId,
            historicByActivityId,
            takenSequenceFlows,
            this::candidateGroupsOf);
    List<ProcessInstanceDto.BpmnEdge> edges =
        BpmnGraphSupport.buildEdges(
            allFlowElements, bpmnModel, reachedActivityIds, takenSequenceFlows);
    List<ProcessInstanceDto.Variable> variables = buildVariables(id, active);
    List<ProcessInstanceDto.TaskItem> tasks = buildTasks(id);
    List<ProcessInstanceDto.TrailEntry> trail = buildTrail(historicActivities);
    List<ProcessInstanceDto.JobItem> jobs = buildJobs(id, bpmnModel);

    Deployment deployment =
        historic.getDeploymentId() != null
            ? repositoryService
                .createDeploymentQuery()
                .deploymentId(historic.getDeploymentId())
                .singleResult()
            : null;

    return new ProcessInstanceDto(
        historic.getId(),
        historic.getProcessDefinitionKey(),
        historic.getProcessDefinitionName() != null
            ? historic.getProcessDefinitionName()
            : historic.getProcessDefinitionKey(),
        historic.getProcessDefinitionVersion() != null ? historic.getProcessDefinitionVersion() : 0,
        historic.getBusinessKey(),
        resolveStatus(historic),
        historic.getStartTime() != null ? historic.getStartTime().toInstant() : null,
        historic.getEndTime() != null ? historic.getEndTime().toInstant() : null,
        historic.getStartUserId(),
        deployment != null ? deployment.getDeploymentTime().toInstant() : null,
        historic.getSuperProcessInstanceId(),
        nodes,
        edges,
        variables,
        tasks,
        trail,
        jobs);
  }

  /**
   * Backs {@code GET custom/instances} - see claudedocs/design-instance-summary-endpoint.md. The
   * bulk-list counterpart to {@link #getInstance(String)}: no BPMN graph, no JDBC audit-table
   * lookups, just the fields list rows render. A single {@link HistoryService} query covers active
   * and ended instances (history tracks from instance creation, not just completion), so unlike the
   * frontend's own historic hydration this needs no separate "active" query to merge.
   *
   * <p>{@code ExecutionQuery} and {@code BaseJobQuery} have no {@code processInstanceIdIn}-style
   * batch filter (checked against the real Flowable 7.1 API, not assumed) - active executions and
   * dead-letter jobs are each fetched with one unfiltered query and grouped by process instance id
   * in memory instead, rather than one query per instance.
   */
  @GetMapping
  public List<ProcessInstanceSummaryDto> listInstanceSummaries() {
    List<HistoricProcessInstance> historics =
        historyService.createHistoricProcessInstanceQuery().list();

    Map<String, List<Execution>> activeExecutionsByInstance =
        runtimeService.createExecutionQuery().onlyChildExecutions().list().stream()
            .filter(e -> e.getActivityId() != null)
            .collect(Collectors.groupingBy(Execution::getProcessInstanceId));

    Map<String, Long> deadLetterCountByInstance =
        managementService.createDeadLetterJobQuery().list().stream()
            .collect(Collectors.groupingBy(Job::getProcessInstanceId, Collectors.counting()));

    Set<String> deploymentIds =
        historics.stream()
            .map(HistoricProcessInstance::getDeploymentId)
            .filter(Objects::nonNull)
            .collect(Collectors.toSet());
    Map<String, Instant> deployedAtByDeployment =
        deploymentIds.isEmpty()
            ? Map.of()
            : repositoryService
                .createDeploymentQuery()
                .deploymentIds(new ArrayList<>(deploymentIds))
                .list()
                .stream()
                .collect(
                    Collectors.toMap(Deployment::getId, d -> d.getDeploymentTime().toInstant()));

    Map<String, BpmnModel> bpmnModelByDefinitionId = new HashMap<>();

    return historics.stream()
        .map(
            h ->
                toSummaryDto(
                    h,
                    activeExecutionsByInstance,
                    deadLetterCountByInstance,
                    deployedAtByDeployment,
                    bpmnModelByDefinitionId))
        .toList();
  }

  private ProcessInstanceSummaryDto toSummaryDto(
      HistoricProcessInstance historic,
      Map<String, List<Execution>> activeExecutionsByInstance,
      Map<String, Long> deadLetterCountByInstance,
      Map<String, Instant> deployedAtByDeployment,
      Map<String, BpmnModel> bpmnModelByDefinitionId) {
    List<Execution> activeExecutions =
        activeExecutionsByInstance.getOrDefault(historic.getId(), List.of());
    List<ProcessInstanceDto.BpmnNode> activeActivities =
        activeExecutions.isEmpty()
            ? List.of()
            : buildActiveActivityNodes(historic, activeExecutions, bpmnModelByDefinitionId);

    return new ProcessInstanceSummaryDto(
        historic.getId(),
        historic.getProcessDefinitionKey(),
        historic.getProcessDefinitionName() != null
            ? historic.getProcessDefinitionName()
            : historic.getProcessDefinitionKey(),
        historic.getProcessDefinitionVersion() != null ? historic.getProcessDefinitionVersion() : 0,
        historic.getBusinessKey(),
        resolveStatus(historic),
        historic.getStartTime() != null ? historic.getStartTime().toInstant() : null,
        historic.getEndTime() != null ? historic.getEndTime().toInstant() : null,
        historic.getStartUserId(),
        historic.getDeploymentId() != null
            ? deployedAtByDeployment.get(historic.getDeploymentId())
            : null,
        historic.getSuperProcessInstanceId(),
        activeActivities,
        deadLetterCountByInstance.getOrDefault(historic.getId(), 0L).intValue());
  }

  /**
   * Resolves each active execution's current activity to a lightweight {@link
   * ProcessInstanceDto.BpmnNode} (id/name/type/state - the fields list rows actually read via the
   * frontend's {@code currentActivities()}). {@link BpmnModel} is parsed once per distinct process
   * definition and cached in {@code bpmnModelByDefinitionId} across the whole request, not once per
   * instance - a page mixing many instances of the same few definitions only pays the parse cost
   * once per definition, not once per instance.
   */
  private List<ProcessInstanceDto.BpmnNode> buildActiveActivityNodes(
      HistoricProcessInstance historic,
      List<Execution> activeExecutions,
      Map<String, BpmnModel> bpmnModelByDefinitionId) {
    BpmnModel bpmnModel =
        bpmnModelByDefinitionId.computeIfAbsent(
            historic.getProcessDefinitionId(), repositoryService::getBpmnModel);
    if (bpmnModel == null) {
      return List.of();
    }
    List<ProcessInstanceDto.BpmnNode> nodes = new ArrayList<>();
    Set<String> seenActivityIds = new HashSet<>();
    for (Execution execution : activeExecutions) {
      String activityId = execution.getActivityId();
      // Multi-instance activities have one execution per iteration - one summary node per
      // activity id is enough here (unlike buildNodes(), which isn't called for the summary).
      if (!seenActivityIds.add(activityId)) {
        continue;
      }
      FlowElement element = bpmnModel.getFlowElement(activityId);
      String type = element != null ? BpmnGraphSupport.mapNodeType(element) : null;
      if (type == null) {
        continue;
      }
      nodes.add(
          BpmnGraphSupport.summaryNode(
              element.getId(),
              element.getName() != null ? element.getName() : element.getId(),
              type,
              "active"));
    }
    return nodes;
  }

  private static String resolveStatus(HistoricProcessInstance historic) {
    if (historic.getEndTime() == null) {
      return "active";
    }
    // Flowable sets deleteReason when a process instance is terminated abnormally (deleted,
    // cancelled by boundary/error event); a null deleteReason means it reached an end event
    // normally.
    return historic.getDeleteReason() == null ? "ended" : "failed";
  }

  private Map<String, TaskInfo> loadTasksByActivityId(String processInstanceId) {
    Map<String, TaskInfo> byActivityId = new HashMap<>();
    for (Task task : taskService.createTaskQuery().processInstanceId(processInstanceId).list()) {
      byActivityId.put(task.getTaskDefinitionKey(), task);
    }
    for (HistoricTaskInstance task :
        historyService
            .createHistoricTaskInstanceQuery()
            .processInstanceId(processInstanceId)
            .finished()
            .list()) {
      byActivityId.putIfAbsent(task.getTaskDefinitionKey(), task);
    }
    return byActivityId;
  }

  private Map<String, ProcessInstanceDto.JobError> loadJobErrorsByActivityId(
      String processInstanceId, BpmnModel bpmnModel) {
    Map<String, ProcessInstanceDto.JobError> byActivityId = new HashMap<>();
    for (Job job :
        managementService.createDeadLetterJobQuery().processInstanceId(processInstanceId).list()) {
      if (job.getElementId() == null) {
        continue;
      }
      String stackTrace = managementService.getDeadLetterJobExceptionStacktrace(job.getId());
      byActivityId.put(
          job.getElementId(),
          new ProcessInstanceDto.JobError(
              StackTraces.extractExceptionClass(stackTrace),
              job.getExceptionMessage(),
              stackTrace,
              job.getRetries()));
    }
    for (Job job :
        managementService
            .createJobQuery()
            .processInstanceId(processInstanceId)
            .withException()
            .list()) {
      if (job.getElementId() == null) {
        continue;
      }
      String stackTrace = managementService.getJobExceptionStacktrace(job.getId());
      byActivityId.putIfAbsent(
          job.getElementId(),
          new ProcessInstanceDto.JobError(
              StackTraces.extractExceptionClass(stackTrace),
              job.getExceptionMessage(),
              stackTrace,
              job.getRetries()));
    }
    return byActivityId;
  }

  /** Sibling to {@link #loadTasksByActivityId}/{@link #loadJobErrorsByActivityId}. */
  private Map<String, Job> loadTimerJobsByActivityId(String processInstanceId) {
    Map<String, Job> timerJobsByActivityId = new HashMap<>();
    for (Job timerJob :
        managementService.createTimerJobQuery().processInstanceId(processInstanceId).list()) {
      if (timerJob.getElementId() != null) {
        timerJobsByActivityId.put(timerJob.getElementId(), timerJob);
      }
    }
    return timerJobsByActivityId;
  }

  /**
   * TaskInfo.getIdentityLinks() is a lazy accessor requiring an active Flowable command context and
   * throws NullPointerException when called on an entity outside the query that produced it
   * (confirmed by reproducing it directly) - use the public
   * TaskService/HistoryService.get*IdentityLinks* methods instead, which manage their own context.
   */
  private List<String> candidateGroupsOf(TaskInfo taskInfo) {
    List<? extends IdentityLinkInfo> links =
        taskInfo instanceof Task
            ? taskService.getIdentityLinksForTask(taskInfo.getId())
            : historyService.getHistoricIdentityLinksForTask(taskInfo.getId());
    List<String> groups =
        links.stream()
            .filter(link -> "candidate".equals(link.getType()) && link.getGroupId() != null)
            .map(IdentityLinkInfo::getGroupId)
            .toList();
    return groups.isEmpty() ? null : groups;
  }

  /**
   * Most recent TAKEN_AT per sequence flow id, for this instance - empty if this instance's
   * lifetime predates the SEQUENCEFLOW_TAKEN listener being active (see class Javadoc).
   */
  private Map<String, Instant> loadTakenSequenceFlows(String processInstanceId) {
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT SEQUENCE_FLOW_ID, MAX(TAKEN_AT) AS TAKEN_AT FROM FLOWTRACE_SEQUENCE_FLOW_TAKEN"
                + " WHERE PROCESS_INSTANCE_ID = ? GROUP BY SEQUENCE_FLOW_ID",
            processInstanceId);
    Map<String, Instant> byFlowId = new HashMap<>();
    for (Map<String, Object> row : rows) {
      byFlowId.put(
          (String) row.get("SEQUENCE_FLOW_ID"), ((Timestamp) row.get("TAKEN_AT")).toInstant());
    }
    return byFlowId;
  }

  private List<ProcessInstanceDto.Variable> buildVariables(
      String processInstanceId, boolean active) {
    Map<String, ProcessInstanceDto.Variable> byName = new HashMap<>();
    if (active) {
      for (VariableInstance variable :
          runtimeService
              .createVariableInstanceQuery()
              .processInstanceId(processInstanceId)
              .list()) {
        byName.put(
            variable.getName(),
            new ProcessInstanceDto.Variable(
                variable.getName(),
                variable.getTypeName(),
                variable.getValue() != null ? variable.getValue().toString() : null,
                loadVariableHistory(processInstanceId, variable.getName())));
      }
    } else {
      for (HistoricVariableInstance variable :
          historyService
              .createHistoricVariableInstanceQuery()
              .processInstanceId(processInstanceId)
              .list()) {
        byName.put(
            variable.getVariableName(),
            new ProcessInstanceDto.Variable(
                variable.getVariableName(),
                variable.getVariableTypeName(),
                variable.getValue() != null ? variable.getValue().toString() : null,
                loadVariableHistory(processInstanceId, variable.getVariableName())));
      }
    }
    return List.copyOf(byName.values());
  }

  private List<ProcessInstanceDto.VariableChange> loadVariableHistory(
      String processInstanceId, String variableName) {
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT CHANGE_TYPE, VARIABLE_VALUE, CHANGED_AT FROM FLOWTRACE_VARIABLE_HISTORY"
                + " WHERE PROCESS_INSTANCE_ID = ? AND VARIABLE_NAME = ? AND CHANGE_TYPE != ?"
                + " ORDER BY CHANGED_AT",
            processInstanceId,
            variableName,
            AuditRepository.VARIABLE_CHANGE_DELETED);
    List<ProcessInstanceDto.VariableChange> history = new ArrayList<>();
    String previousValue = null;
    int revision = 1;
    for (Map<String, Object> row : rows) {
      String newValue = (String) row.get("VARIABLE_VALUE");
      Instant timestamp = ((Timestamp) row.get("CHANGED_AT")).toInstant();
      history.add(
          new ProcessInstanceDto.VariableChange(timestamp, revision++, previousValue, newValue));
      previousValue = newValue;
    }
    return history;
  }

  private List<ProcessInstanceDto.TaskItem> buildTasks(String processInstanceId) {
    List<ProcessInstanceDto.TaskItem> tasks = new ArrayList<>();
    for (Task task : taskService.createTaskQuery().processInstanceId(processInstanceId).list()) {
      tasks.add(
          new ProcessInstanceDto.TaskItem(
              task.getId(),
              task.getName(),
              task.getAssignee(),
              candidateGroupsOf(task),
              task.getDueDate() != null ? task.getDueDate().toInstant() : null,
              task.getPriority(),
              "pending",
              null,
              null));
    }
    for (HistoricTaskInstance task :
        historyService
            .createHistoricTaskInstanceQuery()
            .processInstanceId(processInstanceId)
            .finished()
            .list()) {
      tasks.add(
          new ProcessInstanceDto.TaskItem(
              task.getId(),
              task.getName(),
              task.getAssignee(),
              candidateGroupsOf(task),
              task.getDueDate() != null ? task.getDueDate().toInstant() : null,
              task.getPriority(),
              "completed",
              task.getCompletedBy(),
              task.getDurationInMillis()));
    }
    return tasks;
  }

  private List<ProcessInstanceDto.TrailEntry> buildTrail(
      List<HistoricActivityInstance> historicActivities) {
    return historicActivities.stream()
        .sorted((a, b) -> a.getStartTime().compareTo(b.getStartTime()))
        .map(this::toTrailEntry)
        .filter(Objects::nonNull)
        .toList();
  }

  private ProcessInstanceDto.TrailEntry toTrailEntry(HistoricActivityInstance hai) {
    String type = BpmnGraphSupport.mapActivityType(hai.getActivityType());
    if (type == null) {
      return null;
    }
    return new ProcessInstanceDto.TrailEntry(
        hai.getId(),
        hai.getActivityId(),
        hai.getActivityName() != null ? hai.getActivityName() : hai.getActivityId(),
        type,
        hai.getStartTime().toInstant(),
        hai.getEndTime() != null ? hai.getEndTime().toInstant() : null,
        hai.getDurationInMillis());
  }

  private List<ProcessInstanceDto.JobItem> buildJobs(
      String processInstanceId, BpmnModel bpmnModel) {
    List<ProcessInstanceDto.JobItem> jobs = new ArrayList<>();
    for (Job job :
        managementService.createTimerJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, JobTypes.TIMER, bpmnModel));
    }
    for (Job job : managementService.createJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, JobTypes.ASYNC, bpmnModel));
    }
    for (Job job :
        managementService.createDeadLetterJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, JobTypes.DEADLETTER, bpmnModel));
    }
    return jobs;
  }

  private ProcessInstanceDto.JobItem toJobItem(Job job, String type, BpmnModel bpmnModel) {
    FlowElement element =
        job.getElementId() != null ? bpmnModel.getFlowElement(job.getElementId()) : null;
    return new ProcessInstanceDto.JobItem(
        job.getId(),
        type,
        job.getElementId(),
        element != null && element.getName() != null ? element.getName() : job.getElementId(),
        job.getDuedate() != null ? job.getDuedate().toInstant() : null,
        job.getRetries(),
        job.getExceptionMessage());
  }
}
