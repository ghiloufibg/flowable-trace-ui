package io.github.ghiloufibg.flowable.rest;

import io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceDto;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Function;
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
import org.flowable.bpmn.model.ScriptTask;
import org.flowable.bpmn.model.SequenceFlow;
import org.flowable.bpmn.model.ServiceTask;
import org.flowable.bpmn.model.StartEvent;
import org.flowable.bpmn.model.TimerEventDefinition;
import org.flowable.bpmn.model.UserTask;
import org.flowable.engine.history.HistoricActivityInstance;
import org.flowable.job.api.Job;
import org.flowable.task.api.TaskInfo;

/**
 * Pure BPMN graph-shape logic backing {@link InstanceEnrichmentController}: turning a flattened
 * element list plus runtime/history lookups (already loaded by the controller) into the {@code
 * nodes[]}/{@code edges[]} the frontend renders. Every method here is a function of its parameters
 * only - no Flowable service calls - so it's kept separate from the controller, which owns the
 * actual {@code RepositoryService}/{@code RuntimeService}/etc. orchestration. See {@link
 * InstanceEnrichmentController}'s class Javadoc for the product-level rationale behind the
 * heuristics used here (gateway decision fallback, multi-instance counting, etc.).
 */
final class BpmnGraphSupport {

  private BpmnGraphSupport() {}

  /**
   * Recursively collects every {@link FlowElement} in {@code container}, including those nested
   * inside sub-processes (embedded event sub-processes, ad-hoc sub-processes, transactions, etc. -
   * anything implementing {@link FlowElementsContainer}), not just the container's own direct
   * children. {@code process.getFlowElements()} alone only returns the top level.
   */
  static List<FlowElement> collectAllFlowElements(FlowElementsContainer container) {
    List<FlowElement> all = new ArrayList<>();
    for (FlowElement element : container.getFlowElements()) {
      all.add(element);
      if (element instanceof FlowElementsContainer nestedContainer) {
        all.addAll(collectAllFlowElements(nestedContainer));
      }
    }
    return all;
  }

  static List<ProcessInstanceDto.BpmnNode> buildNodes(
      List<FlowElement> allFlowElements,
      BpmnModel bpmnModel,
      Set<String> activeActivityIds,
      Set<String> reachedActivityIds,
      Map<String, TaskInfo> tasksByActivityId,
      Map<String, ProcessInstanceDto.JobError> jobErrorsByActivityId,
      Map<String, Job> timerJobsByActivityId,
      Map<String, List<HistoricActivityInstance>> historicByActivityId,
      Map<String, Instant> takenSequenceFlows,
      Function<TaskInfo, List<String>> candidateGroupsResolver) {
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
      List<String> candidateGroups =
          taskInfo != null ? candidateGroupsResolver.apply(taskInfo) : null;

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
   * activity, all sharing the element's activity id. See {@link InstanceEnrichmentController}'s
   * class Javadoc for the parallel-exact/sequential-undercounts caveat.
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

  static String mapNodeType(FlowElement element) {
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

  static List<ProcessInstanceDto.BpmnEdge> buildEdges(
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

  static String mapActivityType(String flowableActivityType) {
    if (flowableActivityType == null) {
      return null;
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
      default -> null;
    };
  }

  /**
   * The lightweight node shape used by the instance-summary endpoint (id/name/type/state only) -
   * every enrichment field the full graph endpoint ({@link #buildNodes}) populates is deliberately
   * absent here, spelled out explicitly rather than left as an unlabeled run of positional nulls.
   */
  static ProcessInstanceDto.BpmnNode summaryNode(
      String id, String name, String type, String state) {
    return new ProcessInstanceDto.BpmnNode(
        id,
        name,
        type,
        /* x= */ 0,
        /* y= */ 0,
        /* w= */ null,
        /* h= */ null,
        state,
        /* assignee= */ null,
        /* candidateGroups= */ null,
        /* dueDate= */ null,
        /* priority= */ null,
        /* multiInstance= */ null,
        /* gatewayDecision= */ null,
        /* jobError= */ null,
        /* timerDueAt= */ null,
        /* childInstanceId= */ null,
        /* attachedTo= */ null);
  }
}
