package io.github.ghiloufibg.flowable.rest.dto;

import java.time.Instant;
import java.util.List;

/** Mirrors the frontend's {@code EngineJob} domain type (frontend/src/lib/jobs.ts). */
public record EngineJobDto(
    String id,
    String type,
    String instanceId,
    String businessKey,
    String definitionKey,
    String definitionName,
    int version,
    String activityId,
    String activityName,
    Instant dueDate,
    Instant createdAt,
    int retries,
    int maxRetries,
    String exceptionClass,
    String exceptionMessage,
    String stackTrace,
    String lockOwner,
    Instant lockExpiresAt,
    List<Attempt> attempts) {

  public record Attempt(Instant at, Long durationMs, String outcome, String worker, String error) {}
}
