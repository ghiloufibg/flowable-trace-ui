package io.ghiloufi.flowable.audit;

import java.util.List;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEntityEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.common.engine.api.delegate.event.FlowableEventType;
import org.flowable.common.engine.api.delegate.event.FlowableExceptionEvent;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.delegate.event.FlowableProcessStartedEvent;
import org.flowable.engine.delegate.event.FlowableSequenceFlowTakenEvent;
import org.flowable.engine.repository.Deployment;
import org.flowable.engine.runtime.ProcessInstance;
import org.flowable.job.api.Job;
import org.flowable.variable.api.event.FlowableVariableEvent;

/**
 * Populates the FLOWTRACE_* audit tables from Flowable engine events. Registered on the existing
 * engine's {@code FlowableEventDispatcher} at runtime (see FlowTraceAutoConfiguration) rather than
 * via a ProcessEngineConfigurator, since the engine already exists before this library activates -
 * see claudedocs/backend-library-design.md §6.
 *
 * <p>Only JOB_EXECUTION_SUCCESS/FAILURE are recorded as job attempts, not TIMER_FIRED: a timer
 * firing doesn't have a success/failure outcome by itself, it just precedes execution.
 *
 * <p>{@code instance_started} deployment activity reads {@code getDeploymentId()} directly off the
 * {@link ProcessInstance} entity on {@code FlowableProcessStartedEvent} (the event itself carries
 * no process/deployment id - it only extends {@code FlowableEntityEvent}, not {@code
 * FlowableEngineEvent}) - see {@link #recordInstanceStarted(FlowableProcessStartedEvent)}. {@code
 * superseded} has no dedicated Flowable event at all and is synthesized via a {@link
 * RepositoryService} query, checking whether an earlier deployment with the same key already
 * existed at the moment a new one is created - see {@link
 * #recordSupersededIfApplicable(Deployment)}.
 */
public class FlowTraceAuditEventListener implements FlowableEventListener {

  private final AuditRepository auditRepository;
  private final RepositoryService repositoryService;

  public FlowTraceAuditEventListener(
      AuditRepository auditRepository, RepositoryService repositoryService) {
    this.auditRepository = auditRepository;
    this.repositoryService = repositoryService;
  }

  @Override
  public void onEvent(FlowableEvent event) {
    if (event instanceof FlowableVariableEvent variableEvent) {
      recordVariableEvent(variableEvent);
    } else if (event.getType() == FlowableEngineEventType.ENTITY_CREATED
        && event instanceof FlowableEntityEvent entityEvent
        && entityEvent.getEntity() instanceof Deployment deployment) {
      recordSupersededIfApplicable(deployment);
    } else if (event.getType() == FlowableEngineEventType.ENTITY_DELETED
        && event instanceof FlowableEntityEvent entityEvent
        && entityEvent.getEntity() instanceof Deployment deployment) {
      auditRepository.recordDeploymentActivity(
          deployment.getId(), "delete_attempted", "Deployment delete attempted");
    } else if (event instanceof FlowableEntityEvent entityEvent
        && entityEvent.getEntity() instanceof Job job) {
      recordJobEvent(event, job);
    } else if (event instanceof FlowableSequenceFlowTakenEvent flowEvent) {
      auditRepository.recordSequenceFlowTaken(flowEvent.getProcessInstanceId(), flowEvent.getId());
    } else if (event instanceof FlowableProcessStartedEvent processStarted) {
      recordInstanceStarted(processStarted);
    }
  }

  @Override
  public boolean isFailOnException() {
    // An audit-write failure must never take down the process engine's own execution.
    return false;
  }

  @Override
  public boolean isFireOnTransactionLifecycleEvent() {
    return false;
  }

  @Override
  public String getOnTransaction() {
    return null;
  }

  private void recordVariableEvent(FlowableVariableEvent event) {
    String changeType = changeTypeFor(event.getType());
    if (changeType == null) {
      return;
    }
    Object value = event.getVariableValue();
    auditRepository.recordVariableChange(
        event.getProcessInstanceId(),
        event.getExecutionId(),
        event.getVariableName(),
        event.getVariableType() != null ? event.getVariableType().getTypeName() : null,
        value != null ? value.toString() : null,
        changeType);
  }

  private static String changeTypeFor(FlowableEventType type) {
    if (type == FlowableEngineEventType.VARIABLE_CREATED) {
      return "CREATED";
    }
    if (type == FlowableEngineEventType.VARIABLE_UPDATED) {
      return "UPDATED";
    }
    if (type == FlowableEngineEventType.VARIABLE_DELETED) {
      return "DELETED";
    }
    return null;
  }

  private void recordJobEvent(FlowableEvent event, Job job) {
    String outcome = outcomeFor(event.getType());
    if (outcome == null) {
      return;
    }
    Throwable cause =
        event instanceof FlowableExceptionEvent exceptionEvent ? exceptionEvent.getCause() : null;
    String exceptionMessage = cause != null ? cause.getMessage() : job.getExceptionMessage();
    auditRepository.recordJobAttempt(
        job.getId(),
        job.getProcessInstanceId(),
        outcome,
        exceptionMessage,
        job.getRetries(),
        Thread.currentThread().getName());
  }

  private static String outcomeFor(FlowableEventType type) {
    if (type == FlowableEngineEventType.JOB_EXECUTION_SUCCESS) {
      return "SUCCESS";
    }
    if (type == FlowableEngineEventType.JOB_EXECUTION_FAILURE) {
      return "FAILURE";
    }
    return null;
  }

  /**
   * No Flowable event exists for "this deployment was just superseded" - synthesized here by
   * checking, at the moment a new deployment is created, whether an earlier deployment with the
   * same key already existed. If so, the "superseded" entry is recorded for the earlier
   * deployment's own activity log, not the new one's.
   *
   * <p>Deliberately does NOT assume {@code newDeployment} itself is already visible in this query's
   * results (confirmed empirically that whether it is depends on flush timing within the deploy
   * command's own transaction) - instead finds the most recent *other* deployment sharing the key,
   * whether or not the new one shows up alongside it.
   */
  private void recordSupersededIfApplicable(Deployment newDeployment) {
    if (newDeployment.getKey() == null) {
      return;
    }
    List<Deployment> sameKey =
        repositoryService
            .createDeploymentQuery()
            .deploymentKey(newDeployment.getKey())
            .orderByDeploymentTime()
            .desc()
            .list();
    sameKey.stream()
        .filter(candidate -> !candidate.getId().equals(newDeployment.getId()))
        .findFirst()
        .ifPresent(
            previous ->
                auditRepository.recordDeploymentActivity(
                    previous.getId(),
                    "superseded",
                    "Superseded by deployment " + newDeployment.getId()));
  }

  private void recordInstanceStarted(FlowableProcessStartedEvent event) {
    // FlowableProcessStartedEvent doesn't carry processInstanceId/processDefinitionId directly
    // (it only extends FlowableEntityEvent, not FlowableEngineEvent) - but its entity IS a
    // ProcessInstance, which already has getDeploymentId() directly, no RepositoryService lookup
    // needed here. Confirmed empirically: the entity's own getId() is NOT reliably the process
    // instance id callers see from startProcessInstanceByKey() - it can be a child execution
    // already created by the time this event fires. getProcessInstanceId() (inherited from
    // Execution) always points to the true root instance id regardless of which execution the
    // entity itself is.
    if (!(event.getEntity() instanceof ProcessInstance processInstance)) {
      return;
    }
    auditRepository.recordDeploymentActivity(
        processInstance.getDeploymentId(),
        "instance_started",
        "Instance " + processInstance.getProcessInstanceId() + " started");
  }
}
