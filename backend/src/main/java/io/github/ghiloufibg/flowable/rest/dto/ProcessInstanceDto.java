package io.github.ghiloufibg.flowable.rest.dto;

import java.time.Instant;
import java.util.List;

/**
 * Mirrors the frontend's {@code ProcessInstance} domain type exactly
 * (frontend/src/lib/mock-data.ts). Field names match 1:1 so Jackson's record serialization produces
 * the JSON shape the frontend already expects.
 */
public record ProcessInstanceDto(
    String id,
    String definitionKey,
    String definitionName,
    int version,
    String businessKey,
    String status,
    Instant startedAt,
    Instant endedAt,
    String startedBy,
    Instant deployedAt,
    String parentInstanceId,
    List<BpmnNode> nodes,
    List<BpmnEdge> edges,
    List<Variable> variables,
    List<TaskItem> tasks,
    List<TrailEntry> trail,
    List<JobItem> jobs) {

  public record BpmnNode(
      String id,
      String name,
      String type,
      double x,
      double y,
      Double w,
      Double h,
      String state,
      String assignee,
      List<String> candidateGroups,
      Instant dueDate,
      Integer priority,
      MultiInstanceInfo multiInstance,
      String gatewayDecision,
      JobError jobError,
      Instant timerDueAt,
      String childInstanceId,
      String attachedTo) {}

  public record MultiInstanceInfo(int total, int active, int completed) {}

  public record JobError(String exceptionClass, String message, String stackTrace, int retries) {}

  public record BpmnEdge(
      String id,
      String source,
      String target,
      String label,
      String condition,
      Boolean taken,
      List<Waypoint> waypoints) {}

  public record Waypoint(double x, double y) {}

  public record Variable(String name, String type, String value, List<VariableChange> history) {}

  public record VariableChange(Instant timestamp, int revision, String oldValue, String newValue) {}

  public record TaskItem(
      String id,
      String name,
      String assignee,
      List<String> candidateGroups,
      Instant dueDate,
      int priority,
      String status,
      String completedBy,
      Long durationMs) {}

  public record TrailEntry(
      String id,
      String activityId,
      String activityName,
      String type,
      Instant startedAt,
      Instant endedAt,
      Long durationMs) {}

  public record JobItem(
      String id,
      String type,
      String activityId,
      String activityName,
      Instant dueDate,
      Integer retries,
      String exception) {}
}
