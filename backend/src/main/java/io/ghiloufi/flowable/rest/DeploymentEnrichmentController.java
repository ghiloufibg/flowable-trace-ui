package io.ghiloufi.flowable.rest;

import io.ghiloufi.flowable.rest.dto.DeploymentDto;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.Deployment;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Backs {@code GET custom/deployments/{id}} - see claudedocs/backend-library-design.md §7.2.
 *
 * <p>{@code deployedBy} is always returned as an empty string - investigated and confirmed this has
 * no fix: Flowable has no deployer-identity field anywhere in its data model (neither the public
 * {@code Deployment}/{@code EngineDeployment} API nor the native {@code ACT_RE_DEPLOYMENT} schema),
 * and this library only observes an already-running engine after the fact, so there is no point at
 * which this identity is ever available to capture. See claudedocs/design-deployed-by.md.
 *
 * <p>{@code version} (Flowable versions process definitions, not deployments) is computed as a
 * 1-based ordinal among deployments sharing the same key, ordered by deployment time - the natural
 * analogue of how Flowable computes process-definition versioning internally.
 *
 * <p>{@code activity[]}'s "created" entry is always synthesized inline from {@code
 * deployment.getDeploymentTime()} (zero ordering risk, always available). The
 * superseded/instance_started/delete_attempted entries come from {@code
 * FLOWTRACE_DEPLOYMENT_ACTIVITY}, populated live by {@code FlowTraceAuditEventListener} - see
 * {@link #loadDeploymentActivity(String)}. A deployment deleted via a cascading delete removes the
 * deployment row itself, so a {@code delete_attempted} entry is only visible if read before the
 * delete completes - documented limitation, not hidden.
 *
 * <p>Resources are read via {@code getDeploymentResourceNames}/{@code getResourceAsStream} rather
 * than {@code Deployment.getResources()}: the latter is a lazy accessor that requires an active
 * Flowable command context and throws NullPointerException when called on an entity outside the
 * query that produced it (confirmed by reproducing it directly).
 */
@RestController
@RequestMapping("/custom/deployments")
public class DeploymentEnrichmentController {

  private final RepositoryService repositoryService;
  private final JdbcTemplate jdbcTemplate;

  public DeploymentEnrichmentController(
      RepositoryService repositoryService, ProcessEngine processEngine) {
    this.repositoryService = repositoryService;
    this.jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
  }

  @GetMapping("/{id}")
  public DeploymentDto getDeployment(@PathVariable String id) {
    Deployment deployment =
        repositoryService.createDeploymentQuery().deploymentId(id).singleResult();
    if (deployment == null) {
      throw new ResponseStatusException(HttpStatus.NOT_FOUND, "Deployment not found: " + id);
    }
    return toDto(deployment);
  }

  private DeploymentDto toDto(Deployment deployment) {
    List<DeploymentDto.Resource> resources =
        repositoryService.getDeploymentResourceNames(deployment.getId()).stream()
            .map(name -> toResource(deployment.getId(), name))
            .toList();

    List<DeploymentDto.Definition> definitions =
        repositoryService
            .createProcessDefinitionQuery()
            .deploymentId(deployment.getId())
            .list()
            .stream()
            .map(
                pd ->
                    new DeploymentDto.Definition(
                        pd.getId(),
                        "bpmn",
                        pd.getName() != null ? pd.getName() : pd.getKey(),
                        pd.getKey(),
                        pd.getVersion()))
            .toList();

    List<DeploymentDto.Activity> activity =
        Stream.concat(
                Stream.of(
                    new DeploymentDto.Activity(
                        deployment.getDeploymentTime().toInstant(),
                        "created",
                        "Deployment created")),
                loadDeploymentActivity(deployment.getId()).stream())
            .sorted(Comparator.comparing(DeploymentDto.Activity::at))
            .toList();

    return new DeploymentDto(
        deployment.getId(),
        deployment.getName(),
        deployment.getKey(),
        computeDeploymentVersion(deployment),
        deployment.getTenantId(),
        "api",
        deployment.getDeploymentTime().toInstant(),
        "",
        resources,
        definitions,
        activity);
  }

  private DeploymentDto.Resource toResource(String deploymentId, String resourceName) {
    byte[] bytes;
    try (var stream = repositoryService.getResourceAsStream(deploymentId, resourceName)) {
      bytes = stream != null ? stream.readAllBytes() : null;
    } catch (java.io.IOException e) {
      throw new IllegalStateException("Failed to read deployment resource: " + resourceName, e);
    }
    String kind = resourceKind(resourceName);
    String preview =
        isTextual(kind) && bytes != null
            ? new String(bytes, 0, Math.min(bytes.length, 500), StandardCharsets.UTF_8)
            : null;
    return new DeploymentDto.Resource(
        resourceName, kind, bytes != null ? bytes.length : 0, preview);
  }

  private static String resourceKind(String name) {
    String lower = name.toLowerCase(Locale.ROOT);
    if (lower.endsWith(".bpmn20.xml") || lower.endsWith(".bpmn")) {
      return "bpmn";
    }
    if (lower.endsWith(".dmn")) {
      return "dmn";
    }
    if (lower.endsWith(".cmmn") || lower.endsWith(".cmmn.xml")) {
      return "cmmn";
    }
    if (lower.endsWith(".form")) {
      return "form";
    }
    if (lower.endsWith(".png")
        || lower.endsWith(".jpg")
        || lower.endsWith(".jpeg")
        || lower.endsWith(".svg")) {
      return "image";
    }
    return "other";
  }

  private static boolean isTextual(String kind) {
    return kind.equals("bpmn") || kind.equals("dmn") || kind.equals("cmmn") || kind.equals("form");
  }

  private List<DeploymentDto.Activity> loadDeploymentActivity(String deploymentId) {
    return jdbcTemplate.query(
        "SELECT KIND, DETAIL, OCCURRED_AT FROM FLOWTRACE_DEPLOYMENT_ACTIVITY"
            + " WHERE DEPLOYMENT_ID = ? ORDER BY OCCURRED_AT",
        (rs, rowNum) ->
            new DeploymentDto.Activity(
                rs.getTimestamp("OCCURRED_AT").toInstant(),
                rs.getString("KIND"),
                rs.getString("DETAIL")),
        deploymentId);
  }

  private int computeDeploymentVersion(Deployment deployment) {
    if (deployment.getKey() == null) {
      return 1;
    }
    List<Deployment> sameKey =
        repositoryService
            .createDeploymentQuery()
            .deploymentKey(deployment.getKey())
            .orderByDeploymentTime()
            .asc()
            .list();
    int version = 1;
    for (Deployment candidate : sameKey) {
      if (candidate.getId().equals(deployment.getId())) {
        return version;
      }
      version++;
    }
    return version;
  }
}
