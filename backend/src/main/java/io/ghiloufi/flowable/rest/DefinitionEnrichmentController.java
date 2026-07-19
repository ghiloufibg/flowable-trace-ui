package io.ghiloufi.flowable.rest;

import io.ghiloufi.flowable.rest.dto.ProcessDefinitionDto;
import org.flowable.bpmn.model.BpmnModel;
import org.flowable.bpmn.model.Process;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.repository.ProcessDefinition;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

/**
 * Backs {@code GET custom/definitions/{key}/{version}} - see claudedocs/backend-library-design.md
 * §7.2.
 *
 * <p>{@code isExecutable} isn't on Flowable's deployed ProcessDefinition entity (it's a property of
 * the BPMN {@code <process>} element itself), so it's read from the parsed BpmnModel instead.
 * {@code deployedBy} has no native Flowable equivalent (same gap as DeploymentEnrichmentController)
 * and is returned as an empty string rather than fabricated.
 */
@RestController
@RequestMapping("/custom/definitions")
public class DefinitionEnrichmentController {

  private final RepositoryService repositoryService;

  public DefinitionEnrichmentController(RepositoryService repositoryService) {
    this.repositoryService = repositoryService;
  }

  @GetMapping("/{key}/{version}")
  public ProcessDefinitionDto getDefinition(@PathVariable String key, @PathVariable int version) {
    ProcessDefinition definition =
        repositoryService
            .createProcessDefinitionQuery()
            .processDefinitionKey(key)
            .processDefinitionVersion(version)
            .singleResult();
    if (definition == null) {
      throw new ResponseStatusException(
          HttpStatus.NOT_FOUND, "Process definition not found: " + key + ":" + version);
    }
    return toDto(definition);
  }

  private ProcessDefinitionDto toDto(ProcessDefinition definition) {
    Deployment deployment =
        repositoryService
            .createDeploymentQuery()
            .deploymentId(definition.getDeploymentId())
            .singleResult();
    BpmnModel bpmnModel = repositoryService.getBpmnModel(definition.getId());
    Process process = bpmnModel != null ? bpmnModel.getProcessById(definition.getKey()) : null;

    return new ProcessDefinitionDto(
        definition.getId(),
        definition.getKey(),
        definition.getName() != null ? definition.getName() : definition.getKey(),
        definition.getVersion(),
        definition.getTenantId(),
        definition.getDeploymentId(),
        deployment != null ? deployment.getName() : null,
        deployment != null ? deployment.getDeploymentTime().toInstant() : null,
        "",
        definition.isSuspended(),
        process != null && process.isExecutable(),
        definition.hasStartFormKey(),
        definition.getCategory(),
        definition.getResourceName());
  }
}
