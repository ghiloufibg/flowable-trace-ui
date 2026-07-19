package io.ghiloufi.flowable.audit;

import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEntityEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.common.engine.api.delegate.event.FlowableEventType;
import org.flowable.common.engine.api.delegate.event.FlowableExceptionEvent;
import org.flowable.engine.delegate.event.FlowableSequenceFlowTakenEvent;
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
 */
public class FlowTraceAuditEventListener implements FlowableEventListener {

  private final AuditRepository auditRepository;

  public FlowTraceAuditEventListener(AuditRepository auditRepository) {
    this.auditRepository = auditRepository;
  }

  @Override
  public void onEvent(FlowableEvent event) {
    if (event instanceof FlowableVariableEvent variableEvent) {
      recordVariableEvent(variableEvent);
    } else if (event instanceof FlowableEntityEvent entityEvent
        && entityEvent.getEntity() instanceof Job job) {
      recordJobEvent(event, job);
    } else if (event instanceof FlowableSequenceFlowTakenEvent flowEvent) {
      auditRepository.recordSequenceFlowTaken(flowEvent.getProcessInstanceId(), flowEvent.getId());
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
}
