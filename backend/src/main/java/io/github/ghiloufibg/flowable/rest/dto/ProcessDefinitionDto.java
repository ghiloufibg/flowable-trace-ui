package io.github.ghiloufibg.flowable.rest.dto;

import java.time.Instant;

/**
 * Mirrors the frontend's {@code ProcessDefinition} domain type (frontend/src/lib/definitions.ts).
 */
public record ProcessDefinitionDto(
    String id,
    String key,
    String name,
    int version,
    String tenantId,
    String deploymentId,
    String deploymentName,
    Instant deployedAt,
    String deployedBy,
    boolean isSuspended,
    boolean isExecutable,
    boolean hasStartForm,
    String category,
    String resource) {}
