package io.github.ghiloufibg.flowable.rest;

import io.github.ghiloufibg.flowable.rest.dto.DeploymentDto;
import java.nio.charset.StandardCharsets;
import java.util.Comparator;
import java.util.List;
import java.util.Locale;
import java.util.stream.Stream;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.repository.ProcessDefinition;
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
 * <p>{@code deployedBy} reads {@code deployment.getCategory()} - a free-text field Flowable itself
 * never populates or interprets, repurposed here as an opt-in convention: a consuming application
 * that calls {@code .category(userId)} when deploying will see that value surfaced here; one that
 * doesn't sets nothing and this stays an empty string, exactly as before this convention existed.
 * This is NOT automatic deployer tracking - Flowable has no native field for that anywhere in its
 * data model (neither the public {@code Deployment}/{@code EngineDeployment} API nor the native
 * {@code ACT_RE_DEPLOYMENT} schema), and this library only observes an already-running engine after
 * the fact, so it can never capture deployer identity on its own. See
 * claudedocs/design-deployed-by.md for the full investigation and why this convention is the only
 * viable path.
 *
 * <p>{@code version} (Flowable versions process definitions, not deployments) is the max {@code
 * pd.getVersion()} among the process definitions this deployment contains - see {@link
 * #computeDeploymentVersion(List)}. Deliberately NOT based on {@code Deployment.getKey()}: verified
 * live against a real engine that field is null for essentially every real deployment (neither
 * Spring Boot auto-deployment nor a plain REST resource upload ever sets it), so a
 * deployment-key-based computation always silently returns {@code 1}. Process-definition version is
 * reliable because Flowable computes and maintains it natively, independent of deployment key.
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

    List<ProcessDefinition> processDefinitions =
        repositoryService.createProcessDefinitionQuery().deploymentId(deployment.getId()).list();

    List<DeploymentDto.Definition> definitions =
        processDefinitions.stream()
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
        computeDeploymentVersion(processDefinitions),
        deployment.getTenantId(),
        "api",
        deployment.getDeploymentTime().toInstant(),
        deployment.getCategory() != null ? deployment.getCategory() : "",
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

  /**
   * Max version among the deployment's own process definitions - a deployment containing more than
   * one process definition (not observed in practice, but not disallowed by Flowable) is a
   * documented simplification, not a silent assumption: {@code DeploymentDto.version} is a single
   * {@code int}, so the most conservative single answer to "has any part of this deployment's
   * content been redeployed" is used rather than picking one definition arbitrarily.
   */
  private static int computeDeploymentVersion(List<ProcessDefinition> processDefinitions) {
    return processDefinitions.stream().mapToInt(ProcessDefinition::getVersion).max().orElse(1);
  }
}
