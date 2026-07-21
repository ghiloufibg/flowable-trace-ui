package io.github.ghiloufibg.flowable.rest.dto;

import java.time.Instant;
import java.util.List;

/**
 * Backs {@code GET custom/instances} - the bulk list-row counterpart to {@link ProcessInstanceDto},
 * returned by {@code GET custom/instances/{id}}. See
 * claudedocs/design-instance-summary-endpoint.md.
 *
 * <p>Field names match {@link ProcessInstanceDto}'s scalar fields exactly so the frontend's {@code
 * ProcessInstance} type (which already declares {@code activeActivities}/{@code failedJobCount} as
 * optional, summary-only fields) needs no further change to consume this. {@code nodes}/{@code
 * edges}/{@code variables}/{@code tasks}/{@code trail}/{@code jobs} are omitted entirely rather
 * than sent as empty arrays - the full detail always comes from the per-id endpoint.
 */
public record ProcessInstanceSummaryDto(
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
    List<ProcessInstanceDto.BpmnNode> activeActivities,
    int failedJobCount) {}
