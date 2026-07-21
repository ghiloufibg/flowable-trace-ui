package io.github.ghiloufibg.flowable.rest;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.ghiloufibg.flowable.audit.AuditRepository;
import io.github.ghiloufibg.flowable.audit.FlowTraceAuditEventListener;
import io.github.ghiloufibg.flowable.audit.FlowTraceSchemaInitializer;
import io.github.ghiloufibg.flowable.rest.dto.DeploymentDto;
import io.github.ghiloufibg.flowable.rest.dto.JobHealthDto;
import io.github.ghiloufibg.flowable.rest.dto.ProcessDefinitionDto;
import io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceDto;
import io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceSummaryDto;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.repository.Deployment;
import org.flowable.job.api.Job;
import org.flowable.task.api.Task;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Round-trip test against a real deployed BPMN process (with full BPMNDI) exercising all five
 * custom/** enrichment controllers together, per Phase 5's task description in
 * claudedocs/implementation-plan.md.
 */
class EnrichmentControllersIntegrationTest {

  private static final String PROCESS_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="orderApproval" name="Order Approval" isExecutable="true">
          <startEvent id="start" name="Start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
          <userTask id="review" name="Review Order"/>
          <sequenceFlow id="f2" sourceRef="review" targetRef="decision"/>
          <exclusiveGateway id="decision" name="Approved?"/>
          <sequenceFlow id="f3" name="yes" sourceRef="decision" targetRef="end">
            <conditionExpression xsi:type="tFormalExpression"
                                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${approved}</conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="f4" name="no" sourceRef="decision" targetRef="rejected">
            <conditionExpression xsi:type="tFormalExpression"
                                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${!approved}</conditionExpression>
          </sequenceFlow>
          <endEvent id="end" name="End"/>
          <endEvent id="rejected" name="Rejected"/>
        </process>
        <bpmndi:BPMNDiagram id="diagram">
          <bpmndi:BPMNPlane bpmnElement="orderApproval">
            <bpmndi:BPMNShape bpmnElement="start">
              <omgdc:Bounds x="30" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="review">
              <omgdc:Bounds x="120" y="60" width="100" height="70"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="decision">
              <omgdc:Bounds x="270" y="75" width="40" height="40"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="end">
              <omgdc:Bounds x="360" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="rejected">
              <omgdc:Bounds x="360" y="160" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNEdge bpmnElement="f1">
              <omgdi:waypoint x="60" y="95"/>
              <omgdi:waypoint x="120" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f2">
              <omgdi:waypoint x="220" y="95"/>
              <omgdi:waypoint x="270" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f3">
              <omgdi:waypoint x="310" y="95"/>
              <omgdi:waypoint x="360" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f4">
              <omgdi:waypoint x="290" y="115"/>
              <omgdi:waypoint x="375" y="160"/>
            </bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </definitions>
      """;

  private static final String SUBPROCESS_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="withSubProcess" name="Has A SubProcess" isExecutable="true">
          <startEvent id="start" name="Start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="subProc"/>
          <subProcess id="subProc" name="Approval SubProcess">
            <startEvent id="innerStart" name="Inner Start"/>
            <sequenceFlow id="innerF1" sourceRef="innerStart" targetRef="innerTask"/>
            <userTask id="innerTask" name="Inner Review"/>
            <sequenceFlow id="innerF2" sourceRef="innerTask" targetRef="innerEnd"/>
            <endEvent id="innerEnd" name="Inner End"/>
          </subProcess>
          <sequenceFlow id="f2" sourceRef="subProc" targetRef="end"/>
          <endEvent id="end" name="End"/>
        </process>
        <bpmndi:BPMNDiagram id="diagram">
          <bpmndi:BPMNPlane bpmnElement="withSubProcess">
            <bpmndi:BPMNShape bpmnElement="start">
              <omgdc:Bounds x="30" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="subProc">
              <omgdc:Bounds x="120" y="40" width="260" height="120"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="innerStart">
              <omgdc:Bounds x="140" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="innerTask">
              <omgdc:Bounds x="220" y="65" width="100" height="60"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="innerEnd">
              <omgdc:Bounds x="360" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="end">
              <omgdc:Bounds x="440" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNEdge bpmnElement="f1">
              <omgdi:waypoint x="60" y="95"/>
              <omgdi:waypoint x="120" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="innerF1">
              <omgdi:waypoint x="170" y="95"/>
              <omgdi:waypoint x="220" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="innerF2">
              <omgdi:waypoint x="320" y="95"/>
              <omgdi:waypoint x="360" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f2">
              <omgdi:waypoint x="380" y="95"/>
              <omgdi:waypoint x="440" y="95"/>
            </bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </definitions>
      """;

  private static final String MULTI_INSTANCE_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="multiInstanceReview" name="Multi-Instance Review" isExecutable="true">
          <startEvent id="start" name="Start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="review"/>
          <userTask id="review" name="Review Document">
            <multiInstanceLoopCharacteristics isSequential="false">
              <loopCardinality>3</loopCardinality>
            </multiInstanceLoopCharacteristics>
          </userTask>
          <sequenceFlow id="f2" sourceRef="review" targetRef="end"/>
          <endEvent id="end" name="End"/>
        </process>
        <bpmndi:BPMNDiagram id="diagram">
          <bpmndi:BPMNPlane bpmnElement="multiInstanceReview">
            <bpmndi:BPMNShape bpmnElement="start">
              <omgdc:Bounds x="30" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="review">
              <omgdc:Bounds x="120" y="60" width="100" height="70"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="end">
              <omgdc:Bounds x="270" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNEdge bpmnElement="f1">
              <omgdi:waypoint x="60" y="95"/>
              <omgdi:waypoint x="120" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f2">
              <omgdi:waypoint x="220" y="95"/>
              <omgdi:waypoint x="270" y="95"/>
            </bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </definitions>
      """;

  private static final String CALL_ACTIVITY_PARENT_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="parentWithCallActivity" name="Parent With Call Activity" isExecutable="true">
          <startEvent id="start" name="Start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="callChild"/>
          <callActivity id="callChild" name="Call Child Process" calledElement="childProcess"/>
          <sequenceFlow id="f2" sourceRef="callChild" targetRef="end"/>
          <endEvent id="end" name="End"/>
        </process>
        <bpmndi:BPMNDiagram id="diagram">
          <bpmndi:BPMNPlane bpmnElement="parentWithCallActivity">
            <bpmndi:BPMNShape bpmnElement="start">
              <omgdc:Bounds x="30" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="callChild">
              <omgdc:Bounds x="120" y="60" width="100" height="70"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="end">
              <omgdc:Bounds x="270" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNEdge bpmnElement="f1">
              <omgdi:waypoint x="60" y="95"/>
              <omgdi:waypoint x="120" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f2">
              <omgdi:waypoint x="220" y="95"/>
              <omgdi:waypoint x="270" y="95"/>
            </bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </definitions>
      """;

  private static final String CALL_ACTIVITY_CHILD_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="childProcess" name="Child Process" isExecutable="true">
          <startEvent id="childStart" name="Child Start"/>
          <sequenceFlow id="cf1" sourceRef="childStart" targetRef="childTask"/>
          <userTask id="childTask" name="Child Task"/>
          <sequenceFlow id="cf2" sourceRef="childTask" targetRef="childEnd"/>
          <endEvent id="childEnd" name="Child End"/>
        </process>
      </definitions>
      """;

  private static final String LOOPING_GATEWAY_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                   xmlns:omgdc="http://www.omg.org/spec/DD/20100524/DC"
                   xmlns:omgdi="http://www.omg.org/spec/DD/20100524/DI"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="loopingGateway" name="Looping Gateway" isExecutable="true">
          <startEvent id="start" name="Start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="loopTask"/>
          <userTask id="loopTask" name="Loop Task"/>
          <sequenceFlow id="f2" sourceRef="loopTask" targetRef="decision"/>
          <exclusiveGateway id="decision" name="Done?"/>
          <sequenceFlow id="goBack" name="loop" sourceRef="decision" targetRef="loopTask">
            <conditionExpression xsi:type="tFormalExpression"
                                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${!done}</conditionExpression>
          </sequenceFlow>
          <sequenceFlow id="proceed" name="proceed" sourceRef="decision" targetRef="end">
            <conditionExpression xsi:type="tFormalExpression"
                                  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${done}</conditionExpression>
          </sequenceFlow>
          <endEvent id="end" name="End"/>
        </process>
        <bpmndi:BPMNDiagram id="diagram">
          <bpmndi:BPMNPlane bpmnElement="loopingGateway">
            <bpmndi:BPMNShape bpmnElement="start">
              <omgdc:Bounds x="30" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="loopTask">
              <omgdc:Bounds x="120" y="60" width="100" height="70"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="decision">
              <omgdc:Bounds x="270" y="75" width="40" height="40"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNShape bpmnElement="end">
              <omgdc:Bounds x="380" y="80" width="30" height="30"/>
            </bpmndi:BPMNShape>
            <bpmndi:BPMNEdge bpmnElement="f1">
              <omgdi:waypoint x="60" y="95"/>
              <omgdi:waypoint x="120" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="f2">
              <omgdi:waypoint x="220" y="95"/>
              <omgdi:waypoint x="270" y="95"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="goBack">
              <omgdi:waypoint x="290" y="75"/>
              <omgdi:waypoint x="170" y="60"/>
            </bpmndi:BPMNEdge>
            <bpmndi:BPMNEdge bpmnElement="proceed">
              <omgdi:waypoint x="310" y="95"/>
              <omgdi:waypoint x="380" y="95"/>
            </bpmndi:BPMNEdge>
          </bpmndi:BPMNPlane>
        </bpmndi:BPMNDiagram>
      </definitions>
      """;

  private static final String ASYNC_FAIL_DEFAULT_RETRIES_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:flowable="http://flowable.org/bpmn"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="asyncFailDefaultRetries" isExecutable="true">
          <startEvent id="start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="task"/>
          <serviceTask id="task" flowable:async="true"
                       flowable:class="io.github.ghiloufibg.flowable.rest.EnrichmentControllersIntegrationTest$AlwaysFailingDelegate"/>
          <sequenceFlow id="f2" sourceRef="task" targetRef="end"/>
          <endEvent id="end"/>
        </process>
      </definitions>
      """;

  private static final String ASYNC_FAIL_CUSTOM_RETRIES_XML =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:flowable="http://flowable.org/bpmn"
                   targetNamespace="io.github.ghiloufibg.flowable.rest">
        <process id="asyncFailCustomRetries" isExecutable="true">
          <startEvent id="start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="task"/>
          <serviceTask id="task" flowable:async="true"
                       flowable:class="io.github.ghiloufibg.flowable.rest.EnrichmentControllersIntegrationTest$AlwaysFailingDelegate">
            <extensionElements>
              <flowable:failedJobRetryTimeCycle>R5/PT5M</flowable:failedJobRetryTimeCycle>
            </extensionElements>
          </serviceTask>
          <sequenceFlow id="f2" sourceRef="task" targetRef="end"/>
          <endEvent id="end"/>
        </process>
      </definitions>
      """;

  public static class AlwaysFailingDelegate implements org.flowable.engine.delegate.JavaDelegate {
    @Override
    public void execute(org.flowable.engine.delegate.DelegateExecution execution) {
      throw new RuntimeException("always fails");
    }
  }

  private ProcessEngine processEngine;
  private DeploymentEnrichmentController deploymentController;
  private DefinitionEnrichmentController definitionController;
  private InstanceEnrichmentController instanceController;
  private JobEnrichmentController jobController;
  private JobHealthController jobHealthController;

  @BeforeEach
  void setUp() {
    processEngine =
        ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()
            .setJdbcUrl("jdbc:h2:mem:flowtrace-rest-" + UUID.randomUUID())
            .setAsyncExecutorActivate(false)
            .buildProcessEngine();

    DataSource dataSource = processEngine.getProcessEngineConfiguration().getDataSource();
    FlowTraceSchemaInitializer.migrate(dataSource);
    AuditRepository auditRepository = new AuditRepository(dataSource);
    processEngine
        .getProcessEngineConfiguration()
        .getEventDispatcher()
        .addEventListener(
            new FlowTraceAuditEventListener(auditRepository, processEngine.getRepositoryService()),
            FlowableEngineEventType.VARIABLE_CREATED,
            FlowableEngineEventType.VARIABLE_UPDATED,
            FlowableEngineEventType.VARIABLE_DELETED,
            FlowableEngineEventType.JOB_EXECUTION_SUCCESS,
            FlowableEngineEventType.JOB_EXECUTION_FAILURE,
            FlowableEngineEventType.SEQUENCEFLOW_TAKEN,
            FlowableEngineEventType.ENTITY_CREATED,
            FlowableEngineEventType.ENTITY_DELETED,
            FlowableEngineEventType.PROCESS_STARTED);

    deploymentController =
        new DeploymentEnrichmentController(processEngine.getRepositoryService(), processEngine);
    definitionController = new DefinitionEnrichmentController(processEngine.getRepositoryService());
    instanceController =
        new InstanceEnrichmentController(
            processEngine.getRepositoryService(),
            processEngine.getRuntimeService(),
            processEngine.getTaskService(),
            processEngine.getHistoryService(),
            processEngine.getManagementService(),
            processEngine);
    jobController =
        new JobEnrichmentController(
            processEngine.getManagementService(),
            processEngine.getRepositoryService(),
            processEngine.getRuntimeService(),
            processEngine.getHistoryService(),
            processEngine);
    jobHealthController = new JobHealthController(processEngine.getManagementService());
  }

  @Test
  void deploymentEnrichmentReturnsResourcesAndDefinitions() {
    Deployment deployment =
        processEngine
            .getRepositoryService()
            .createDeployment()
            .name("Order Approval Deployment")
            .addString("orderApproval.bpmn20.xml", PROCESS_XML)
            .deploy();

    DeploymentDto dto = deploymentController.getDeployment(deployment.getId());

    assertThat(dto.id()).isEqualTo(deployment.getId());
    assertThat(dto.version()).isEqualTo(1);
    // Flowable auto-generates a diagram PNG alongside the BPMN XML on deploy (createDiagramOnDeploy
    // default), so a single-resource deployment produces two DeploymentDto.Resource entries.
    assertThat(dto.resources()).hasSize(2);
    var bpmnResource =
        dto.resources().stream().filter(r -> r.kind().equals("bpmn")).findFirst().orElseThrow();
    assertThat(bpmnResource.preview()).contains("orderApproval");
    var imageResource =
        dto.resources().stream().filter(r -> r.kind().equals("image")).findFirst().orElseThrow();
    assertThat(imageResource.preview()).isNull();
    assertThat(dto.definitions()).hasSize(1);
    assertThat(dto.definitions().get(0).key()).isEqualTo("orderApproval");
    assertThat(dto.activity()).hasSize(1);
    assertThat(dto.activity().get(0).kind()).isEqualTo("created");
    assertThat(dto.deployedBy()).isEmpty();
  }

  @Test
  void deploymentAndDefinitionEnrichmentSurfaceDeployedByWhenCategoryIsSetAsTheOptInConvention() {
    Deployment deployment =
        processEngine
            .getRepositoryService()
            .createDeployment()
            .name("Order Approval Deployment")
            .category("alice")
            .addString("orderApproval.bpmn20.xml", PROCESS_XML)
            .deploy();

    DeploymentDto deploymentDto = deploymentController.getDeployment(deployment.getId());
    assertThat(deploymentDto.deployedBy()).isEqualTo("alice");

    ProcessDefinitionDto definitionDto = definitionController.getDefinition("orderApproval", 1);
    assertThat(definitionDto.deployedBy()).isEqualTo("alice");
  }

  @Test
  void deploymentEnrichmentReportsSupersededWhenANewerDeploymentSharesTheKey() {
    // Deliberately NOT calling .key(...) on either DeploymentBuilder - confirmed live against a
    // real engine that Deployment.getKey() is null for essentially every real deployment (neither
    // Spring Boot auto-deployment nor a plain REST upload ever sets it). The process DEFINITION
    // key ("orderApproval", from PROCESS_XML's <process id="orderApproval">) is what actually
    // drives Flowable's native versioning and this fix's superseded/version logic.
    Deployment first =
        processEngine
            .getRepositoryService()
            .createDeployment()
            .name("Order Approval Deployment v1")
            .addString("orderApproval.bpmn20.xml", PROCESS_XML)
            .deploy();

    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment v2")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    DeploymentDto firstDto = deploymentController.getDeployment(first.getId());
    assertThat(firstDto.activity())
        .extracting(DeploymentDto.Activity::kind)
        .containsExactly("created", "superseded");
    assertThat(firstDto.version()).isEqualTo(1);

    var secondProcessDefinition =
        processEngine
            .getRepositoryService()
            .createProcessDefinitionQuery()
            .processDefinitionKey("orderApproval")
            .latestVersion()
            .singleResult();
    DeploymentDto secondDto =
        deploymentController.getDeployment(secondProcessDefinition.getDeploymentId());
    assertThat(secondDto.version()).isEqualTo(2);
  }

  @Test
  void deploymentEnrichmentReportsInstanceStartedWhenAProcessInstanceStarts() {
    Deployment deployment =
        processEngine
            .getRepositoryService()
            .createDeployment()
            .name("Order Approval Deployment")
            .addString("orderApproval.bpmn20.xml", PROCESS_XML)
            .deploy();

    var instance =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", Map.of("approved", true));

    DeploymentDto dto = deploymentController.getDeployment(deployment.getId());
    assertThat(dto.activity())
        .extracting(DeploymentDto.Activity::kind)
        .containsExactly("created", "instance_started");
    assertThat(dto.activity().get(1).detail()).contains(instance.getId());
  }

  @Test
  void deploymentEnrichmentAuditTableRecordsDeleteAttempted() {
    // The deployment itself is gone after a cascading delete, so this checks the audit table
    // directly rather than through the (now 404-ing) DeploymentEnrichmentController - matches
    // the documented caveat that a delete_attempted entry is only visible if read before the
    // delete completes.
    Deployment deployment =
        processEngine
            .getRepositoryService()
            .createDeployment()
            .name("Order Approval Deployment")
            .addString("orderApproval.bpmn20.xml", PROCESS_XML)
            .deploy();

    processEngine.getRepositoryService().deleteDeployment(deployment.getId(), true);

    var rows =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource())
            .queryForList(
                "SELECT * FROM FLOWTRACE_DEPLOYMENT_ACTIVITY WHERE DEPLOYMENT_ID = ? AND KIND = ?",
                deployment.getId(),
                "delete_attempted");
    assertThat(rows).hasSize(1);
  }

  @Test
  void definitionEnrichmentReturnsExecutableFlagAndStartForm() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    ProcessDefinitionDto dto = definitionController.getDefinition("orderApproval", 1);

    assertThat(dto.key()).isEqualTo("orderApproval");
    assertThat(dto.version()).isEqualTo(1);
    assertThat(dto.isExecutable()).isTrue();
    assertThat(dto.hasStartForm()).isFalse();
    assertThat(dto.deploymentName()).isNotNull();
    assertThat(dto.deployedBy()).isEmpty();
  }

  @Test
  void instanceEnrichmentReflectsGraphStateVariablesAndTasksAcrossTheProcessLifecycle() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", "ORD-100");
    var runtimeInstance =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-100", variables);
    String instanceId = runtimeInstance.getId();

    // -- stage 1: sitting at the user task --------------------------------------------------
    ProcessInstanceDto atUserTask = instanceController.getInstance(instanceId);
    assertThat(atUserTask.status()).isEqualTo("active");
    assertThat(atUserTask.businessKey()).isEqualTo("ORD-100");
    assertThat(atUserTask.definitionKey()).isEqualTo("orderApproval");

    var startNode = findNode(atUserTask, "start");
    assertThat(startNode.state()).isEqualTo("completed");
    assertThat(startNode.x()).isEqualTo(30);
    assertThat(startNode.y()).isEqualTo(80);

    var reviewNode = findNode(atUserTask, "review");
    assertThat(reviewNode.state()).isEqualTo("active");
    assertThat(reviewNode.type()).isEqualTo("userTask");

    var decisionNode = findNode(atUserTask, "decision");
    assertThat(decisionNode.state()).isEqualTo("pending");

    var edgeF1 = findEdge(atUserTask, "f1");
    assertThat(edgeF1.taken()).isTrue();
    assertThat(edgeF1.waypoints()).hasSize(2);

    var edgeF3 = findEdge(atUserTask, "f3");
    assertThat(edgeF3.taken()).isFalse();

    assertThat(atUserTask.variables()).hasSize(1);
    var orderIdVariable = atUserTask.variables().get(0);
    assertThat(orderIdVariable.name()).isEqualTo("orderId");
    assertThat(orderIdVariable.value()).isEqualTo("ORD-100");
    assertThat(orderIdVariable.history()).hasSize(1);
    assertThat(orderIdVariable.history().get(0).newValue()).isEqualTo("ORD-100");

    assertThat(atUserTask.tasks()).hasSize(1);
    assertThat(atUserTask.tasks().get(0).status()).isEqualTo("pending");

    // -- stage 2: complete the task, take the gateway, reach the end ------------------------
    Task task =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    processEngine.getRuntimeService().setVariable(instanceId, "approved", true);
    processEngine.getTaskService().complete(task.getId());

    ProcessInstanceDto ended = instanceController.getInstance(instanceId);
    assertThat(ended.status()).isEqualTo("ended");
    assertThat(ended.endedAt()).isNotNull();

    var reviewNodeAfter = findNode(ended, "review");
    assertThat(reviewNodeAfter.state()).isEqualTo("completed");

    var decisionNodeAfter = findNode(ended, "decision");
    assertThat(decisionNodeAfter.state()).isEqualTo("completed");
    assertThat(decisionNodeAfter.gatewayDecision()).isEqualTo("yes");

    var edgeF3After = findEdge(ended, "f3");
    assertThat(edgeF3After.taken()).isTrue();

    assertThat(ended.tasks()).hasSize(1);
    assertThat(ended.tasks().get(0).status()).isEqualTo("completed");
    assertThat(ended.tasks().get(0).completedBy()).isNull();

    assertThat(ended.trail()).isNotEmpty();
    assertThat(ended.trail().stream().map(ProcessInstanceDto.TrailEntry::activityId))
        .contains("start", "review", "decision", "end");
  }

  @Test
  void instanceEnrichmentIncludesNodesAndEdgesNestedInsideAnEmbeddedSubProcess() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("SubProcess Nesting Deployment")
        .addString("withSubProcess.bpmn20.xml", SUBPROCESS_XML)
        .deploy();

    String instanceId =
        processEngine.getRuntimeService().startProcessInstanceByKey("withSubProcess").getId();

    // -- stage 1: sitting at the userTask nested inside the subProcess ----------------------
    ProcessInstanceDto atInnerTask = instanceController.getInstance(instanceId);

    // process.getFlowElements() alone would never see these - they're children of the
    // subProcess container, not of the top-level process. This is exactly what
    // collectAllFlowElements()'s recursion into every FlowElementsContainer exists to fix.
    var innerTaskNode = findNode(atInnerTask, "innerTask");
    assertThat(innerTaskNode.type()).isEqualTo("userTask");
    assertThat(innerTaskNode.state()).isEqualTo("active");

    var innerStartNode = findNode(atInnerTask, "innerStart");
    assertThat(innerStartNode.state()).isEqualTo("completed");

    var innerF1Edge = findEdge(atInnerTask, "innerF1");
    assertThat(innerF1Edge.taken()).isTrue();

    var innerF2Edge = findEdge(atInnerTask, "innerF2");
    assertThat(innerF2Edge.taken()).isFalse();

    // the subProcess container shape itself is not a supported node type - only its children
    // are walked and surfaced, per the class-level Javadoc on InstanceEnrichmentController.
    assertThat(atInnerTask.nodes().stream().map(ProcessInstanceDto.BpmnNode::id))
        .doesNotContain("subProc");

    // -- stage 2: complete the inner task, subProcess ends, outer flow reaches "end" --------
    Task innerTask =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    processEngine.getTaskService().complete(innerTask.getId());

    ProcessInstanceDto ended = instanceController.getInstance(instanceId);
    assertThat(ended.status()).isEqualTo("ended");

    var innerF2EdgeAfter = findEdge(ended, "innerF2");
    assertThat(innerF2EdgeAfter.taken()).isTrue();

    var outerF2Edge = findEdge(ended, "f2");
    assertThat(outerF2Edge.taken()).isTrue();

    assertThat(ended.trail().stream().map(ProcessInstanceDto.TrailEntry::activityId))
        .contains("innerStart", "innerTask", "innerEnd");
  }

  @Test
  void instanceEnrichmentReportsMultiInstanceProgressForAParallelMultiInstanceUserTask() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Multi-Instance Review Deployment")
        .addString("multiInstanceReview.bpmn20.xml", MULTI_INSTANCE_XML)
        .deploy();

    String instanceId =
        processEngine.getRuntimeService().startProcessInstanceByKey("multiInstanceReview").getId();

    // -- stage 1: all 3 parallel instances started, none completed yet ----------------------
    ProcessInstanceDto atStart = instanceController.getInstance(instanceId);
    var reviewNodeAtStart = findNode(atStart, "review");
    assertThat(reviewNodeAtStart.multiInstance()).isNotNull();
    assertThat(reviewNodeAtStart.multiInstance().total()).isEqualTo(3);
    assertThat(reviewNodeAtStart.multiInstance().active()).isEqualTo(3);
    assertThat(reviewNodeAtStart.multiInstance().completed()).isZero();

    // non-multi-instance nodes are unaffected - still null, not a zeroed-out struct.
    var startNode = findNode(atStart, "start");
    assertThat(startNode.multiInstance()).isNull();

    // -- stage 2: complete 2 of 3 ------------------------------------------------------------
    var tasks =
        processEngine.getTaskService().createTaskQuery().processInstanceId(instanceId).list();
    assertThat(tasks).hasSize(3);
    processEngine.getTaskService().complete(tasks.get(0).getId());
    processEngine.getTaskService().complete(tasks.get(1).getId());

    ProcessInstanceDto partiallyDone = instanceController.getInstance(instanceId);
    var reviewNodePartial = findNode(partiallyDone, "review");
    assertThat(reviewNodePartial.multiInstance().total()).isEqualTo(3);
    assertThat(reviewNodePartial.multiInstance().active()).isEqualTo(1);
    assertThat(reviewNodePartial.multiInstance().completed()).isEqualTo(2);

    // -- stage 3: complete the last one, instance ends ---------------------------------------
    processEngine.getTaskService().complete(tasks.get(2).getId());

    ProcessInstanceDto ended = instanceController.getInstance(instanceId);
    assertThat(ended.status()).isEqualTo("ended");
    var reviewNodeEnded = findNode(ended, "review");
    assertThat(reviewNodeEnded.multiInstance().total()).isEqualTo(3);
    assertThat(reviewNodeEnded.multiInstance().active()).isZero();
    assertThat(reviewNodeEnded.multiInstance().completed()).isEqualTo(3);
  }

  @Test
  void instanceEnrichmentResolvesCallActivityChildInstanceId() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Call Activity Deployment")
        .addString("parentWithCallActivity.bpmn20.xml", CALL_ACTIVITY_PARENT_XML)
        .addString("childProcess.bpmn20.xml", CALL_ACTIVITY_CHILD_XML)
        .deploy();

    String parentInstanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("parentWithCallActivity")
            .getId();

    var childInstance =
        processEngine
            .getRuntimeService()
            .createProcessInstanceQuery()
            .processDefinitionKey("childProcess")
            .singleResult();

    // -- stage 1: call activity active, child process still running ------------------------
    ProcessInstanceDto atCallActivity = instanceController.getInstance(parentInstanceId);
    var callNode = findNode(atCallActivity, "callChild");
    assertThat(callNode.type()).isEqualTo("callActivity");
    assertThat(callNode.state()).isEqualTo("active");
    assertThat(callNode.childInstanceId()).isEqualTo(childInstance.getId());

    // non-call-activity nodes are unaffected.
    var startNode = findNode(atCallActivity, "start");
    assertThat(startNode.childInstanceId()).isNull();

    // -- stage 2: complete the child task, child ends, call activity completes --------------
    Task childTask =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(childInstance.getId())
            .singleResult();
    processEngine.getTaskService().complete(childTask.getId());

    ProcessInstanceDto ended = instanceController.getInstance(parentInstanceId);
    assertThat(ended.status()).isEqualTo("ended");
    var callNodeAfter = findNode(ended, "callChild");
    // childInstanceId stays populated after completion - not cleared once the call finishes.
    assertThat(callNodeAfter.childInstanceId()).isEqualTo(childInstance.getId());
  }

  @Test
  void instanceEnrichmentReportsTheMostRecentGatewayDecisionForALoopThatChangesBranch() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Looping Gateway Deployment")
        .addString("loopingGateway.bpmn20.xml", LOOPING_GATEWAY_XML)
        .deploy();

    Map<String, Object> variables = new HashMap<>();
    variables.put("done", false);
    String instanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("loopingGateway", variables)
            .getId();

    // -- pass 1: not done yet, gateway loops back to loopTask -------------------------------
    Task firstPass =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    processEngine.getTaskService().complete(firstPass.getId());

    // -- pass 2: now done, gateway proceeds to end -------------------------------------------
    processEngine.getRuntimeService().setVariable(instanceId, "done", true);
    Task secondPass =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    processEngine.getTaskService().complete(secondPass.getId());

    ProcessInstanceDto ended = instanceController.getInstance(instanceId);
    assertThat(ended.status()).isEqualTo("ended");

    // Both "loopTask" and "end" were eventually reached, so the old reachable-successor
    // heuristic would report "loop" (first in BPMN document order) here - wrong, since the
    // gateway's actual final decision was "proceed". Authoritative data (ordered by TAKEN_AT)
    // must report the latest decision instead.
    var decisionNode = findNode(ended, "decision");
    assertThat(decisionNode.gatewayDecision()).isEqualTo("proceed");

    var goBackEdge = findEdge(ended, "goBack");
    assertThat(goBackEdge.taken()).isTrue();
    var proceedEdge = findEdge(ended, "proceed");
    assertThat(proceedEdge.taken()).isTrue();
  }

  @Test
  void instanceEnrichmentFallsBackToTheHeuristicWhenNoSequenceFlowAuditDataExists() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    Map<String, Object> variables = new HashMap<>();
    variables.put("approved", true);
    String instanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-200", variables)
            .getId();

    Task task =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    processEngine.getTaskService().complete(task.getId());

    // Simulate an instance whose lifetime predates the SEQUENCEFLOW_TAKEN listener being
    // attached: no audit rows for it at all, even though the instance is otherwise complete.
    new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource())
        .update(
            "DELETE FROM FLOWTRACE_SEQUENCE_FLOW_TAKEN WHERE PROCESS_INSTANCE_ID = ?", instanceId);

    ProcessInstanceDto ended = instanceController.getInstance(instanceId);
    var decisionNode = findNode(ended, "decision");
    assertThat(decisionNode.gatewayDecision()).isEqualTo("yes");

    var edgeF3 = findEdge(ended, "f3");
    assertThat(edgeF3.taken()).isTrue();
    var edgeF4 = findEdge(ended, "f4");
    assertThat(edgeF4.taken()).isFalse();
  }

  @Test
  void instanceEnrichmentOmitsTrailEntriesForUnsupportedHistoricActivityTypes() {
    // Sequence-flow-level HistoricActivityInstance rows (activityType "sequenceFlow") only
    // appear at Flowable's "full" history level - the shared engine in setUp() doesn't use that
    // level, so this test builds its own engine to actually reproduce the mislabeling bug this
    // test guards against (confirmed via a throwaway probe this session: at "full" history,
    // sequenceFlow rows genuinely appear alongside the supported activity types).
    ProcessEngine fullHistoryEngine =
        ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()
            .setJdbcUrl("jdbc:h2:mem:flowtrace-fullhistory-" + UUID.randomUUID())
            .setAsyncExecutorActivate(false)
            .setHistory("full")
            .buildProcessEngine();
    FlowTraceSchemaInitializer.migrate(
        fullHistoryEngine.getProcessEngineConfiguration().getDataSource());
    InstanceEnrichmentController fullHistoryInstanceController =
        new InstanceEnrichmentController(
            fullHistoryEngine.getRepositoryService(),
            fullHistoryEngine.getRuntimeService(),
            fullHistoryEngine.getTaskService(),
            fullHistoryEngine.getHistoryService(),
            fullHistoryEngine.getManagementService(),
            fullHistoryEngine);

    fullHistoryEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    Map<String, Object> variables = new HashMap<>();
    variables.put("approved", true);
    String instanceId =
        fullHistoryEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", variables)
            .getId();
    Task task =
        fullHistoryEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(instanceId)
            .singleResult();
    fullHistoryEngine.getTaskService().complete(task.getId());

    ProcessInstanceDto ended = fullHistoryInstanceController.getInstance(instanceId);

    // The sequence flows (f1, f2, f3) are real activity ids in this fixture too, so assert on
    // *type*, not just id, to actually distinguish "the sequence-flow row was omitted" from "an
    // activity row happens to share that id."
    assertThat(ended.trail())
        .extracting(io.github.ghiloufibg.flowable.rest.dto.ProcessInstanceDto.TrailEntry::type)
        .containsOnly("startEvent", "userTask", "exclusiveGateway", "endEvent");
    assertThat(ended.trail().stream().map(ProcessInstanceDto.TrailEntry::activityId))
        .contains("start", "review", "decision", "end");
  }

  @Test
  void instanceSummaryEndpointReturnsListRowFieldsAcrossActiveAndEndedInstances() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    String activeInstanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-300", Map.of())
            .getId();

    String endedInstanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-301", Map.of("approved", true))
            .getId();
    Task endedTask =
        processEngine
            .getTaskService()
            .createTaskQuery()
            .processInstanceId(endedInstanceId)
            .singleResult();
    processEngine.getTaskService().complete(endedTask.getId());

    List<ProcessInstanceSummaryDto> summaries = instanceController.listInstanceSummaries();
    assertThat(summaries).hasSize(2);

    ProcessInstanceSummaryDto activeSummary = findSummary(summaries, activeInstanceId);
    assertThat(activeSummary.status()).isEqualTo("active");
    assertThat(activeSummary.businessKey()).isEqualTo("ORD-300");
    assertThat(activeSummary.definitionKey()).isEqualTo("orderApproval");
    assertThat(activeSummary.version()).isEqualTo(1);
    assertThat(activeSummary.startedAt()).isNotNull();
    assertThat(activeSummary.endedAt()).isNull();
    assertThat(activeSummary.deployedAt()).isNotNull();
    assertThat(activeSummary.failedJobCount()).isZero();
    assertThat(activeSummary.activeActivities())
        .extracting(ProcessInstanceDto.BpmnNode::id)
        .containsExactly("review");
    assertThat(activeSummary.activeActivities().get(0).type()).isEqualTo("userTask");
    assertThat(activeSummary.activeActivities().get(0).state()).isEqualTo("active");

    ProcessInstanceSummaryDto endedSummary = findSummary(summaries, endedInstanceId);
    assertThat(endedSummary.status()).isEqualTo("ended");
    assertThat(endedSummary.businessKey()).isEqualTo("ORD-301");
    assertThat(endedSummary.endedAt()).isNotNull();
    assertThat(endedSummary.activeActivities()).isEmpty();
  }

  @Test
  void instanceSummaryEndpointReportsDeadLetterCountPerInstance() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("asyncFailDefaultRetries.bpmn20.xml", ASYNC_FAIL_DEFAULT_RETRIES_XML)
        .deploy();
    String instanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("asyncFailDefaultRetries")
            .getId();
    Job job = processEngine.getManagementService().createJobQuery().singleResult();
    processEngine.getManagementService().moveJobToDeadLetterJob(job.getId());

    List<ProcessInstanceSummaryDto> summaries = instanceController.listInstanceSummaries();

    ProcessInstanceSummaryDto summary = findSummary(summaries, instanceId);
    assertThat(summary.failedJobCount()).isEqualTo(1);
  }

  @Test
  void
      instanceSummaryEndpointResolvesActiveActivitiesIndependentlyAcrossInstancesOfTheSameDefinition() {
    // Exercises the per-request BpmnModel cache (bpmnModelByDefinitionId): both instances share
    // one process definition, so the model is parsed once and reused - this asserts that reuse
    // doesn't cross-contaminate results between the two instances.
    processEngine
        .getRepositoryService()
        .createDeployment()
        .name("Order Approval Deployment")
        .addString("orderApproval.bpmn20.xml", PROCESS_XML)
        .deploy();

    String firstInstanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-400", Map.of())
            .getId();
    String secondInstanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("orderApproval", "ORD-401", Map.of())
            .getId();

    List<ProcessInstanceSummaryDto> summaries = instanceController.listInstanceSummaries();

    for (String id : List.of(firstInstanceId, secondInstanceId)) {
      ProcessInstanceSummaryDto summary = findSummary(summaries, id);
      assertThat(summary.activeActivities())
          .extracting(ProcessInstanceDto.BpmnNode::id)
          .containsExactly("review");
      assertThat(summary.activeActivities().get(0).name()).isEqualTo("Review Order");
    }
  }

  private static ProcessInstanceSummaryDto findSummary(
      List<ProcessInstanceSummaryDto> summaries, String instanceId) {
    return summaries.stream()
        .filter(s -> s.id().equals(instanceId))
        .findFirst()
        .orElseThrow(() -> new AssertionError("Summary not found: " + instanceId));
  }

  @Test
  void jobEnrichmentPopulatesLockOwnerAndLockExpiresAtFromNativeJobTables() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("asyncFailDefaultRetries.bpmn20.xml", ASYNC_FAIL_DEFAULT_RETRIES_XML)
        .deploy();
    processEngine.getRuntimeService().startProcessInstanceByKey("asyncFailDefaultRetries");
    Job job = processEngine.getManagementService().createJobQuery().singleResult();

    // Simulate a worker having acquired this job - LOCK_OWNER_/LOCK_EXP_TIME_ aren't reachable
    // via any public Flowable API, only by writing/reading the native ACT_RU_JOB columns
    // directly, which is exactly what this test is verifying the read side of.
    // Truncated to millis: java.sql.Timestamp round-trips through H2 at microsecond precision,
    // so a raw Instant.now() (nanosecond precision) would never compare equal after the read-back.
    Instant lockExpiry =
        Instant.now().plusSeconds(300).truncatedTo(java.time.temporal.ChronoUnit.MILLIS);
    new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource())
        .update(
            "UPDATE ACT_RU_JOB SET LOCK_OWNER_ = ?, LOCK_EXP_TIME_ = ? WHERE ID_ = ?",
            "worker-1",
            Timestamp.from(lockExpiry),
            job.getId());

    var dto = jobController.getJob(job.getId());
    assertThat(dto.lockOwner()).isEqualTo("worker-1");
    assertThat(dto.lockExpiresAt()).isEqualTo(lockExpiry);
  }

  @Test
  void jobEnrichmentReturnsNullLockInfoForDeadLetterJobs() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("asyncFailDefaultRetries.bpmn20.xml", ASYNC_FAIL_DEFAULT_RETRIES_XML)
        .deploy();
    processEngine.getRuntimeService().startProcessInstanceByKey("asyncFailDefaultRetries");
    Job job = processEngine.getManagementService().createJobQuery().singleResult();

    processEngine.getManagementService().moveJobToDeadLetterJob(job.getId());

    var dto = jobController.getJob(job.getId());
    assertThat(dto.type()).isEqualTo("deadletter");
    assertThat(dto.lockOwner()).isNull();
    assertThat(dto.lockExpiresAt()).isNull();
  }

  @Test
  void jobEnrichmentResolvesConfiguredMaxRetriesFromBpmnModelRatherThanJobState() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("asyncFailCustomRetries.bpmn20.xml", ASYNC_FAIL_CUSTOM_RETRIES_XML)
        .deploy();
    String instanceId =
        processEngine
            .getRuntimeService()
            .startProcessInstanceByKey("asyncFailCustomRetries")
            .getId();
    Job job = processEngine.getManagementService().createJobQuery().singleResult();

    // Before any execution, the job's own retries is Flowable's hardcoded default (3), NOT the
    // configured 5 - confirmed empirically. maxRetries must come from the BPMN model, not the job.
    var beforeExecution = jobController.getJob(job.getId());
    assertThat(beforeExecution.retries()).isEqualTo(3);
    assertThat(beforeExecution.maxRetries()).isEqualTo(5);

    try {
      processEngine.getManagementService().executeJob(job.getId());
    } catch (Exception expected) {
      // AlwaysFailingDelegate always throws; that's the point of this test.
    }

    // After the first failure, Flowable reschedules with a decremented retries count derived
    // from the configured cycle - the job may now live in a different native table (id
    // stability across that move isn't assumed here), so re-resolve it by instance instead of
    // trusting the original id still resolves to the same table.
    Job rescheduled =
        processEngine
            .getManagementService()
            .createTimerJobQuery()
            .processInstanceId(instanceId)
            .singleResult();
    assertThat(rescheduled).as("job should have been rescheduled as a timer job").isNotNull();
    var afterFailure = jobController.getJob(rescheduled.getId());
    assertThat(afterFailure.retries()).isEqualTo(4);
    assertThat(afterFailure.maxRetries())
        .as("maxRetries reflects the configured ceiling, unaffected by the decrement")
        .isEqualTo(5);
  }

  @Test
  void jobEnrichmentDefaultsMaxRetriesWhenNoRetryCycleIsConfigured() {
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString("asyncFailDefaultRetries.bpmn20.xml", ASYNC_FAIL_DEFAULT_RETRIES_XML)
        .deploy();
    processEngine.getRuntimeService().startProcessInstanceByKey("asyncFailDefaultRetries");
    Job job = processEngine.getManagementService().createJobQuery().singleResult();

    var dto = jobController.getJob(job.getId());
    assertThat(dto.maxRetries()).isEqualTo(3);
  }

  @Test
  void jobHealthReturnsZeroCountsWhenThereAreNoJobs() {
    JobHealthDto health = jobHealthController.getJobHealth();

    assertThat(health.timers()).isZero();
    assertThat(health.async()).isZero();
    assertThat(health.dead()).isZero();
    assertThat(health.locked()).isZero();
  }

  private static ProcessInstanceDto.BpmnNode findNode(ProcessInstanceDto instance, String id) {
    return instance.nodes().stream()
        .filter(n -> n.id().equals(id))
        .findFirst()
        .orElseThrow(() -> new AssertionError("Node not found: " + id));
  }

  private static ProcessInstanceDto.BpmnEdge findEdge(ProcessInstanceDto instance, String id) {
    return instance.edges().stream()
        .filter(e -> e.id().equals(id))
        .findFirst()
        .orElseThrow(() -> new AssertionError("Edge not found: " + id));
  }
}
