package io.ghiloufi.flowable.rest.dto;

import java.time.Instant;
import java.util.List;

/** Mirrors the frontend's {@code Deployment} domain type (frontend/src/lib/deployments.ts). */
public record DeploymentDto(
    String id,
    String name,
    String key,
    int version,
    String tenantId,
    String source,
    Instant deployedAt,
    String deployedBy,
    List<Resource> resources,
    List<Definition> definitions,
    List<Activity> activity) {

  public record Resource(String name, String kind, long sizeBytes, String preview) {}

  public record Definition(String id, String kind, String name, String key, int version) {}

  public record Activity(Instant at, String kind, String detail) {}
}
