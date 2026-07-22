package io.github.ghiloufibg.flowable.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.delegate.DelegateExecution;
import org.flowable.engine.delegate.JavaDelegate;
import org.flowable.job.api.Job;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

class FlowTraceAuditEventListenerTest {

  private static final String PROCESS_XML_TEMPLATE =
      """
      <?xml version="1.0" encoding="UTF-8"?>
      <definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL"
                   xmlns:flowable="http://flowable.org/bpmn"
                   targetNamespace="io.github.ghiloufibg.flowable.audit">
        <process id="%s" isExecutable="true">
          <startEvent id="start"/>
          <sequenceFlow id="f1" sourceRef="start" targetRef="task"/>
          <serviceTask id="task" flowable:async="true" flowable:class="%s"/>
          <sequenceFlow id="f2" sourceRef="task" targetRef="end"/>
          <endEvent id="end"/>
        </process>
      </definitions>
      """;

  public static class NoopDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {}
  }

  public static class FailingDelegate implements JavaDelegate {
    @Override
    public void execute(DelegateExecution execution) {
      throw new RuntimeException("boom");
    }
  }

  private static ProcessEngine buildEngineWithAuditListenerAttached() {
    ProcessEngine processEngine =
        ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()
            .setJdbcUrl("jdbc:h2:mem:flowtrace-audit-" + UUID.randomUUID())
            .setAsyncExecutorActivate(false)
            .buildProcessEngine();

    DataSource dataSource = processEngine.getProcessEngineConfiguration().getDataSource();
    FlowTraceSchemaInitializer.resetSchema(dataSource);

    AuditRepository auditRepository = new AuditRepository(dataSource);
    FlowTraceAuditEventListener listener =
        new FlowTraceAuditEventListener(auditRepository, processEngine.getRepositoryService());
    processEngine
        .getProcessEngineConfiguration()
        .getEventDispatcher()
        .addEventListener(
            listener,
            FlowableEngineEventType.VARIABLE_CREATED,
            FlowableEngineEventType.VARIABLE_UPDATED,
            FlowableEngineEventType.VARIABLE_DELETED,
            FlowableEngineEventType.JOB_EXECUTION_SUCCESS,
            FlowableEngineEventType.JOB_EXECUTION_FAILURE);
    return processEngine;
  }

  @Test
  void recordsVariableCreationInTheAuditTable() {
    ProcessEngine processEngine = buildEngineWithAuditListenerAttached();
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString(
            "noop.bpmn20.xml",
            PROCESS_XML_TEMPLATE.formatted("noopProcess", NoopDelegate.class.getName()))
        .deploy();

    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", "ORD-42");
    var instance =
        processEngine.getRuntimeService().startProcessInstanceByKey("noopProcess", variables);

    JdbcTemplate jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_VARIABLE_HISTORY WHERE PROCESS_INSTANCE_ID = ?",
            instance.getId());

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsEntry("VARIABLE_NAME", "orderId");
    assertThat(rows.get(0)).containsEntry("VARIABLE_VALUE", "ORD-42");
    assertThat(rows.get(0)).containsEntry("CHANGE_TYPE", "CREATED");
  }

  @Test
  void recordsSuccessfulJobExecutionInTheAuditTable() {
    ProcessEngine processEngine = buildEngineWithAuditListenerAttached();
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString(
            "success.bpmn20.xml",
            PROCESS_XML_TEMPLATE.formatted("successProcess", NoopDelegate.class.getName()))
        .deploy();

    var instance = processEngine.getRuntimeService().startProcessInstanceByKey("successProcess");
    Job job =
        processEngine
            .getManagementService()
            .createJobQuery()
            .processInstanceId(instance.getId())
            .singleResult();

    processEngine.getManagementService().executeJob(job.getId());

    JdbcTemplate jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_JOB_ATTEMPT WHERE JOB_ID = ?", job.getId());

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsEntry("OUTCOME", "SUCCESS");
  }

  @Test
  void recordsFailedJobExecutionInTheAuditTable() {
    ProcessEngine processEngine = buildEngineWithAuditListenerAttached();
    processEngine
        .getRepositoryService()
        .createDeployment()
        .addString(
            "failure.bpmn20.xml",
            PROCESS_XML_TEMPLATE.formatted("failureProcess", FailingDelegate.class.getName()))
        .deploy();

    var instance = processEngine.getRuntimeService().startProcessInstanceByKey("failureProcess");
    Job job =
        processEngine
            .getManagementService()
            .createJobQuery()
            .processInstanceId(instance.getId())
            .singleResult();

    try {
      processEngine.getManagementService().executeJob(job.getId());
    } catch (Exception expected) {
      // FailingDelegate always throws; that's the point of this test.
    }

    JdbcTemplate jdbcTemplate =
        new JdbcTemplate(processEngine.getProcessEngineConfiguration().getDataSource());
    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_JOB_ATTEMPT WHERE JOB_ID = ?", job.getId());

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsEntry("OUTCOME", "FAILURE");
    assertThat(rows.get(0).get("EXCEPTION_MESSAGE")).asString().contains("boom");
  }
}
