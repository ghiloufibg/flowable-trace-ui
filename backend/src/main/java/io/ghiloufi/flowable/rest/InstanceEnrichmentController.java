package io.ghiloufi.flowable.rest;

import io.ghiloufi.flowable.rest.dto.ProcessInstanceDto;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.flowable.bpmn.model.Activity;
import org.flowable.bpmn.model.BoundaryEvent;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.CallActivity;
import org.flowable.bpmn.model.EndEvent;
import org.flowable.bpmn.model.ExclusiveGateway;
import org.flowable.bpmn.model.FlowElement;
import org.flowable.bpmn.model.FlowElementsContainer;
import org.flowable.bpmn.model.GraphicInfo;
import org.flowable.bpmn.model.ParallelGateway;
import org.flowable.bpmn.model.Process;
import org.flowable.bpmn.model.ScriptTask;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.TimerEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.engine.history.HistoricProcessInstance;
import org.flowable.engine.repository.Deployment;
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
 * and jobs.
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
 * are omitted from {@code nodes[]} rather than mislabeled.
 *
 * <p>{@code multiInstance} counts are derived from {@link HistoricActivityInstance} rows grouped by
 * activity id (one row per loop iteration) rather than execution-tree traversal - see {@link
 * #computeMultiInstanceInfo(List)}. For parallel multi-instance this is exact (all iterations' rows
 * exist as soon as the activity starts); for *sequential* multi-instance, {@code total}
 * under-counts the true loop cardinality until the last iteration has started, since rows are
 * created one at a time. Same standard as {@code gatewayDecision}: documented heuristic, not a
 * silent guess.
 *
 * <p>{@code callActivity.childInstanceId} comes directly from {@link
 * HistoricActivityInstance#getCalledProcessInstanceId()} - see {@link
 * #resolveCallActivityChildInstanceId(List)}. Populated as soon as the child process instance
 * starts, not only after the call activity completes. A call activity that is itself multi-instance
 * (rare, technically allowed by BPMN) can spawn more than one child instance; since the DTO field
 * is a single string, one is reported (the currently-running one if any, else the most recently
 * started) rather than the full set.
 *
 * <p>Flow elements nested inside a sub-process (including an embedded, {@code triggeredByEvent}
 * event sub-process) ARE walked and included when their own type is otherwise supported - {@link
 * #collectAllFlowElements(FlowElementsContainer)} recurses into every {@link FlowElementsContainer}
 * (which {@link Process} and every sub-process type implement) rather than reading only {@code
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
      ProcessEngine processEngine) {
    this.repositoryService = repositoryService;
    this.runtimeService = runtimeService;
    this.taskService = taskService;
    this.historyService = historyService;
    this.managementService = managementService;
    this.jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
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
    List<FlowElement> allFlowElements = collectAllFlowElements(process);

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
    Map<String, List<HistoricActivityInstance>> historicByActivityId =
        historicActivities.stream()
            .collect(Collectors.groupingBy(HistoricActivityInstance::getActivityId));
    Map<String, Instant> takenSequenceFlows = loadTakenSequenceFlows(id);

    List<ProcessInstanceDto.BpmnNode> nodes =
        buildNodes(
            id,
            allFlowElements,
            bpmnModel,
            activeActivityIds,
            reachedActivityIds,
            tasksByActivityId,
            jobErrorsByActivityId,
            historicByActivityId,
            takenSequenceFlows);
    List<ProcessInstanceDto.BpmnEdge> edges =
        buildEdges(allFlowElements, bpmnModel, reachedActivityIds, takenSequenceFlows);
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
              extractExceptionClass(stackTrace),
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
              extractExceptionClass(stackTrace),
              job.getExceptionMessage(),
              stackTrace,
              job.getRetries()));
    }
    return byActivityId;
  }

  /**
   * Recursively collects every {@link FlowElement} in {@code container}, including those nested
   * inside sub-processes (embedded event sub-processes, ad-hoc sub-processes, transactions, etc. -
   * anything implementing {@link FlowElementsContainer}), not just the container's own direct
   * children. {@code process.getFlowElements()} alone only returns the top level.
   */
  private static List<FlowElement> collectAllFlowElements(FlowElementsContainer container) {
    List<FlowElement> all = new ArrayList<>();
    for (FlowElement element : container.getFlowElements()) {
      all.add(element);
      if (element instanceof FlowElementsContainer nestedContainer) {
        all.addAll(collectAllFlowElements(nestedContainer));
      }
    }
    return all;
  }

  private List<ProcessInstanceDto.BpmnNode> buildNodes(
      String processInstanceId,
      List<FlowElement> allFlowElements,
      BpmnModel bpmnModel,
      Set<String> activeActivityIds,
      Set<String> reachedActivityIds,
      Map<String, TaskInfo> tasksByActivityId,
      Map<String, ProcessInstanceDto.JobError> jobErrorsByActivityId,
      Map<String, List<HistoricActivityInstance>> historicByActivityId,
      Map<String, Instant> takenSequenceFlows) {
    Map<String, Job> timerJobsByActivityId = new HashMap<>();
    for (Job timerJob :
        managementService.createTimerJobQuery().processInstanceId(processInstanceId).list()) {
      if (timerJob.getElementId() != null) {
        timerJobsByActivityId.put(timerJob.getElementId(), timerJob);
      }
    }

    List<ProcessInstanceDto.BpmnNode> nodes = new ArrayList<>();
    for (FlowElement element : allFlowElements) {
      String type = mapNodeType(element);
      if (type == null) {
        continue;
      }
      GraphicInfo graphicInfo = bpmnModel.getGraphicInfo(element.getId());
      if (graphicInfo == null) {
        continue;
      }

      boolean isActive = activeActivityIds.contains(element.getId());
      ProcessInstanceDto.JobError jobError = jobErrorsByActivityId.get(element.getId());
      String state =
          isActive
              ? (jobError != null ? "failed" : "active")
              : (reachedActivityIds.contains(element.getId()) ? "completed" : "pending");

      TaskInfo taskInfo = tasksByActivityId.get(element.getId());
      String assignee = taskInfo != null ? taskInfo.getAssignee() : null;
      Instant dueDate =
          taskInfo != null && taskInfo.getDueDate() != null
              ? taskInfo.getDueDate().toInstant()
              : null;
      Integer priority = taskInfo != null ? taskInfo.getPriority() : null;
      List<String> candidateGroups = taskInfo != null ? candidateGroupsOf(taskInfo) : null;

      Instant timerDueAt = null;
      String attachedTo = null;
      if (element instanceof BoundaryEvent boundaryEvent) {
        attachedTo = boundaryEvent.getAttachedToRefId();
        Job timerJob = timerJobsByActivityId.get(element.getId());
        timerDueAt =
            timerJob != null && timerJob.getDuedate() != null
                ? timerJob.getDuedate().toInstant()
                : null;
      }

      String gatewayDecision =
          (element instanceof ExclusiveGateway) && reachedActivityIds.contains(element.getId())
              ? resolveGatewayDecision(
                  allFlowElements, element, reachedActivityIds, takenSequenceFlows)
              : null;

      ProcessInstanceDto.MultiInstanceInfo multiInstance =
          (element instanceof Activity activity && activity.getLoopCharacteristics() != null)
              ? computeMultiInstanceInfo(
                  historicByActivityId.getOrDefault(element.getId(), List.of()))
              : null;

      String childInstanceId =
          (element instanceof CallActivity)
              ? resolveCallActivityChildInstanceId(
                  historicByActivityId.getOrDefault(element.getId(), List.of()))
              : null;

      nodes.add(
          new ProcessInstanceDto.BpmnNode(
              element.getId(),
              element.getName() != null ? element.getName() : element.getId(),
              type,
              graphicInfo.getX(),
              graphicInfo.getY(),
              graphicInfo.getWidth(),
              graphicInfo.getHeight(),
              state,
              assignee,
              candidateGroups,
              dueDate,
              priority,
              multiInstance,
              gatewayDecision,
              jobError,
              timerDueAt,
              childInstanceId,
              attachedTo));
    }
    return nodes;
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
          (String) row.get("SEQUENCE_FLOW_ID"),
          ((java.sql.Timestamp) row.get("TAKEN_AT")).toInstant());
    }
    return byFlowId;
  }

  private static String resolveGatewayDecision(
      List<FlowElement> allFlowElements,
      FlowElement gateway,
      Set<String> reachedActivityIds,
      Map<String, Instant> takenSequenceFlows) {
    var outgoing =
        allFlowElements.stream()
            .filter(
                e -> e instanceof SequenceFlow flow && flow.getSourceRef().equals(gateway.getId()))
            .map(e -> (SequenceFlow) e);
    if (!takenSequenceFlows.isEmpty()) {
      return outgoing
          .filter(flow -> takenSequenceFlows.containsKey(flow.getId()))
          .max(Comparator.comparing(flow -> takenSequenceFlows.get(flow.getId())))
          .map(flow -> flow.getName() != null ? flow.getName() : flow.getTargetRef())
          .orElse(null);
    }
    return outgoing
        .filter(flow -> reachedActivityIds.contains(flow.getTargetRef()))
        .findFirst()
        .map(flow -> flow.getName() != null ? flow.getName() : flow.getTargetRef())
        .orElse(null);
  }

  /**
   * One {@link HistoricActivityInstance} row exists per loop iteration of a multi-instance
   * activity, all sharing the element's activity id. See the class Javadoc for the
   * parallel-exact/sequential-undercounts caveat.
   */
  private static ProcessInstanceDto.MultiInstanceInfo computeMultiInstanceInfo(
      List<HistoricActivityInstance> instances) {
    if (instances.isEmpty()) {
      return null;
    }
    int total = instances.size();
    int completed = (int) instances.stream().filter(hai -> hai.getEndTime() != null).count();
    return new ProcessInstanceDto.MultiInstanceInfo(total, total - completed, completed);
  }

  /**
   * Prefers the currently-running call (endTime == null) if one exists, since that's the case the
   * "jump to child instance" UI action cares about most; otherwise falls back to the most recently
   * started call. A call activity re-executed via a loop/multi-instance combination has multiple
   * rows here - this reports one, not a list, matching the DTO's single-value field.
   */
  private static String resolveCallActivityChildInstanceId(List<HistoricActivityInstance> calls) {
    return calls.stream()
        .filter(hai -> hai.getEndTime() == null)
        .findFirst()
        .or(() -> calls.stream().max(Comparator.comparing(HistoricActivityInstance::getStartTime)))
        .map(HistoricActivityInstance::getCalledProcessInstanceId)
        .orElse(null);
  }

  private static String mapNodeType(FlowElement element) {
    if (element instanceof BoundaryEvent boundaryEvent) {
      return hasTimerDefinition(boundaryEvent) ? "boundaryTimer" : null;
    }
    if (element instanceof StartEvent) {
      return "startEvent";
    }
    if (element instanceof EndEvent) {
      return "endEvent";
    }
    if (element instanceof UserTask) {
      return "userTask";
    }
    if (element instanceof ServiceTask) {
      return "serviceTask";
    }
    if (element instanceof ScriptTask) {
      return "scriptTask";
    }
    if (element instanceof ExclusiveGateway) {
      return "exclusiveGateway";
    }
    if (element instanceof ParallelGateway) {
      return "parallelGateway";
    }
    if (element instanceof CallActivity) {
      return "callActivity";
    }
    return null;
  }

  private static boolean hasTimerDefinition(BoundaryEvent event) {
    return event.getEventDefinitions().stream()
        .anyMatch(def -> def instanceof TimerEventDefinition);
  }

  private List<ProcessInstanceDto.BpmnEdge> buildEdges(
      List<FlowElement> allFlowElements,
      BpmnModel bpmnModel,
      Set<String> reachedActivityIds,
      Map<String, Instant> takenSequenceFlows) {
    List<ProcessInstanceDto.BpmnEdge> edges = new ArrayList<>();
    for (FlowElement element : allFlowElements) {
      if (!(element instanceof SequenceFlow flow)) {
        continue;
      }
      List<GraphicInfo> waypointInfos = bpmnModel.getFlowLocationGraphicInfo(flow.getId());
      List<ProcessInstanceDto.Waypoint> waypoints =
          waypointInfos == null
              ? null
              : waypointInfos.stream()
                  .map(gi -> new ProcessInstanceDto.Waypoint(gi.getX(), gi.getY()))
                  .toList();
      boolean taken =
          !takenSequenceFlows.isEmpty()
              ? takenSequenceFlows.containsKey(flow.getId())
              : reachedActivityIds.contains(flow.getSourceRef())
                  && reachedActivityIds.contains(flow.getTargetRef());
      edges.add(
          new ProcessInstanceDto.BpmnEdge(
              flow.getId(),
              flow.getSourceRef(),
              flow.getTargetRef(),
              flow.getName(),
              flow.getConditionExpression(),
              taken,
              waypoints));
    }
    return edges;
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
                + " WHERE PROCESS_INSTANCE_ID = ? AND VARIABLE_NAME = ? AND CHANGE_TYPE != 'DELETED'"
                + " ORDER BY CHANGED_AT",
            processInstanceId,
            variableName);
    List<ProcessInstanceDto.VariableChange> history = new ArrayList<>();
    String previousValue = null;
    int revision = 1;
    for (Map<String, Object> row : rows) {
      String newValue = (String) row.get("VARIABLE_VALUE");
      Instant timestamp = ((java.sql.Timestamp) row.get("CHANGED_AT")).toInstant();
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
        .map(
            hai ->
                new ProcessInstanceDto.TrailEntry(
                    hai.getId(),
                    hai.getActivityId(),
                    hai.getActivityName() != null ? hai.getActivityName() : hai.getActivityId(),
                    mapActivityType(hai.getActivityType()),
                    hai.getStartTime().toInstant(),
                    hai.getEndTime() != null ? hai.getEndTime().toInstant() : null,
                    hai.getDurationInMillis()))
        .toList();
  }

  private static String mapActivityType(String flowableActivityType) {
    if (flowableActivityType == null) {
      return "serviceTask";
    }
    return switch (flowableActivityType) {
      case "startEvent" -> "startEvent";
      case "endEvent" -> "endEvent";
      case "userTask" -> "userTask";
      case "serviceTask" -> "serviceTask";
      case "scriptTask" -> "scriptTask";
      case "exclusiveGateway" -> "exclusiveGateway";
      case "parallelGateway" -> "parallelGateway";
      case "callActivity" -> "callActivity";
      case "boundaryTimer" -> "boundaryTimer";
      default -> "serviceTask";
    };
  }

  private List<ProcessInstanceDto.JobItem> buildJobs(
      String processInstanceId, BpmnModel bpmnModel) {
    List<ProcessInstanceDto.JobItem> jobs = new ArrayList<>();
    for (Job job :
        managementService.createTimerJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, "timer", bpmnModel));
    }
    for (Job job : managementService.createJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, "async", bpmnModel));
    }
    for (Job job :
        managementService.createDeadLetterJobQuery().processInstanceId(processInstanceId).list()) {
      jobs.add(toJobItem(job, "deadletter", bpmnModel));
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

  private static String extractExceptionClass(String stackTrace) {
    if (stackTrace == null || stackTrace.isBlank()) {
      return null;
    }
    String firstLine = stackTrace.lines().findFirst().orElse("");
    int colonIndex = firstLine.indexOf(':');
    return colonIndex > 0 ? firstLine.substring(0, colonIndex).trim() : firstLine.trim();
  }
}
