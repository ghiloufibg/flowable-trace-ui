package io.ghiloufi.flowable.spike;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicReference;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.common.engine.api.delegate.event.FlowableEvent;
import org.flowable.common.engine.api.delegate.event.FlowableEventListener;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.variable.api.event.FlowableVariableEvent;
import org.junit.jupiter.api.Test;

/**
 * Answers design-doc open decision #2: is it safe to attach a FlowableEventListener to an
 * ALREADY-BUILT engine's FlowableEventDispatcher (the only option available to us, since we never
 * build the engine ourselves per decision #4), and does it fire synchronously on the caller's
 * thread (so audit writes can't silently race the caller)?
 */
class EventDispatcherRuntimeAttachTest {

  private static final String PROCESS_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   targetNamespace="io.ghiloufi.flowable.spike">
        <process id="spikeProcess" isExecutable="true">
          <startEvent id="start"/>
          <sequenceFlow id="flow1" sourceRef="start" targetRef="end"/>
          <endEvent id="end"/>
        </process>
      </definitions>
      """;

  @Test
  void listenerAttachedAfterEngineCreationFiresSynchronouslyOnTheCallerThread() {
    ProcessEngine processEngine =
        ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()
            .setJdbcUrl("jdbc:h2:mem:flowtrace-spike-" + UUID.randomUUID())
            .buildProcessEngine();

    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("spikeProcess.bpmn20.xml", PROCESS_XML)
        .deploy();

    AtomicReference<FlowableVariableEvent> captured = new AtomicReference<>();
    AtomicReference<Thread> capturedOnThread = new AtomicReference<>();
    FlowableEventListener listener =
        new FlowableEventListener() {
          @Override
          public void onEvent(FlowableEvent event) {
            if (event instanceof FlowableVariableEvent variableEvent) {
              captured.set(variableEvent);
              capturedOnThread.set(Thread.currentThread());
            }
          }

          @Override
          public boolean isFailOnException() {
            return true;
          }

          @Override
          public boolean isFireOnTransactionLifecycleEvent() {
            return false;
          }

          @Override
          public String getOnTransaction() {
            return null;
          }
        };

    // This is the only attachment point available to us: the engine already exists (per
    // decision #4, we never build one), so ProcessEngineConfigurator (build-time only) cannot
    // be used - the event dispatcher is the sole supported runtime-attachable extension point.
    processEngine
        .getProcessEngineConfiguration()
        .getEventDispatcher()
        .addEventListener(listener, FlowableEngineEventType.VARIABLE_CREATED);

    Thread callerThread = Thread.currentThread();
    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", "ORD-1");
    processEngine.getRuntimeService().startProcessInstanceByKey("spikeProcess", variables);

    assertThat(captured.get())
        .as("listener should have received the VARIABLE_CREATED event")
        .isNotNull();
    assertThat(captured.get().getVariableName()).isEqualTo("orderId");
    assertThat(captured.get().getVariableValue()).isEqualTo("ORD-1");
    assertThat(capturedOnThread.get())
        .as("event should fire synchronously on the caller's thread, not a background thread")
        .isEqualTo(callerThread);
  }
}
