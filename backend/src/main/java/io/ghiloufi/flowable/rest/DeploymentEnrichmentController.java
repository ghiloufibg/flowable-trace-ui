package io.ghiloufi.flowable.rest;

import io.ghiloufi.flowable.rest.dto.DeploymentDto;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Locale;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.Deployment;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Backs {@code GET custom/deployments/{id}} - see claudedocs/backend-library-design.md §7.2.
 *
 * <p>Two fields have no native Flowable equivalent and are handled as documented gaps rather than
 * fabricated: {@code deployedBy} (Flowable doesn't track deployment authorship) is returned as an
 * empty string, and {@code version} (Flowable versions process definitions, not deployments) is
 * computed as a 1-based ordinal among deployments sharing the same key, ordered by deployment time
 * - the natural analogue of how Flowable computes process-definition versioning internally. {@code
 * activity[]} is scoped to a single synthetic "created" entry for v1;
 * superseded/instance-started/delete-attempted entries would need their own audit table, which is
 * out of scope for this phase.
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

  public DeploymentEnrichmentController(RepositoryService repositoryService) {
    this.repositoryService = repositoryService;
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
        List.of(
            new DeploymentDto.Activity(
                deployment.getDeploymentTime().toInstant(), "created", "Deployment created"));

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
