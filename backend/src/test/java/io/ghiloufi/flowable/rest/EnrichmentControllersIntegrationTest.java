package io.ghiloufi.flowable.rest;

import static org.assertj.core.api.Assertions.assertThat;

import io.ghiloufi.flowable.audit.AuditRepository;
import io.ghiloufi.flowable.audit.FlowTraceAuditEventListener;
import io.ghiloufi.flowable.audit.FlowTraceSchemaInitializer;
import io.ghiloufi.flowable.rest.dto.DeploymentDto;
import io.ghiloufi.flowable.rest.dto.JobHealthDto;
import io.ghiloufi.flowable.rest.dto.ProcessDefinitionDto;
import io.ghiloufi.flowable.rest.dto.ProcessInstanceDto;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.repository.Deployment;
import org.flowable.task.api.Task;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

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
                   targetNamespace="io.ghiloufi.flowable.rest">
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
                   targetNamespace="io.ghiloufi.flowable.rest">
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
                   targetNamespace="io.ghiloufi.flowable.rest">
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
                   targetNamespace="io.ghiloufi.flowable.rest">
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
                   targetNamespace="io.ghiloufi.flowable.rest">
        <process id="childProcess" name="Child Process" isExecutable="true">
          <startEvent id="childStart" name="Child Start"/>
          <sequenceFlow id="cf1" sourceRef="childStart" targetRef="childTask"/>
          <userTask id="childTask" name="Child Task"/>
          <sequenceFlow id="cf2" sourceRef="childTask" targetRef="childEnd"/>
          <endEvent id="childEnd" name="Child End"/>
        </process>
      </definitions>
      """;

  private ProcessEngine processEngine;
  private DeploymentEnrichmentController deploymentController;
  private DefinitionEnrichmentController definitionController;
  private InstanceEnrichmentController instanceController;
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
            new FlowTraceAuditEventListener(auditRepository),
            FlowableEngineEventType.VARIABLE_CREATED,
            FlowableEngineEventType.VARIABLE_UPDATED,
            FlowableEngineEventType.VARIABLE_DELETED,
            FlowableEngineEventType.JOB_EXECUTION_SUCCESS,
            FlowableEngineEventType.JOB_EXECUTION_FAILURE);

    deploymentController = new DeploymentEnrichmentController(processEngine.getRepositoryService());
    definitionController = new DefinitionEnrichmentController(processEngine.getRepositoryService());
    instanceController =
        new InstanceEnrichmentController(
            processEngine.getRepositoryService(),
            processEngine.getRuntimeService(),
            processEngine.getTaskService(),
            processEngine.getHistoryService(),
            processEngine.getManagementService(),
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
