package io.github.ghiloufibg.flowable.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Direct unit coverage for {@link AuditRepository}'s four insert methods, previously only exercised
 * indirectly through {@code FlowTraceAuditEventListenerTest} and the full enrichment-controller
 * integration test.
 */
class AuditRepositoryTest {

  private JdbcTemplate jdbcTemplate;
  private AuditRepository auditRepository;

  @BeforeEach
  void setUp() {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:audit-repository-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
    FlowTraceSchemaInitializer.resetSchema(dataSource);
    jdbcTemplate = new JdbcTemplate(dataSource);
    auditRepository = new AuditRepository(dataSource);
  }

  @Test
  void recordVariableChangeInsertsARow() {
    auditRepository.recordVariableChange(
        "instance-1",
        "exec-1",
        "orderId",
        "string",
        "ORD-1",
        AuditRepository.VARIABLE_CHANGE_CREATED);

    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_VARIABLE_HISTORY WHERE PROCESS_INSTANCE_ID = ?", "instance-1");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0))
        .containsEntry("EXECUTION_ID", "exec-1")
        .containsEntry("VARIABLE_NAME", "orderId")
        .containsEntry("VARIABLE_TYPE", "string")
        .containsEntry("VARIABLE_VALUE", "ORD-1")
        .containsEntry("CHANGE_TYPE", "CREATED");
    assertThat(rows.get(0).get("ID")).isNotNull();
    assertThat(rows.get(0).get("CHANGED_AT")).isNotNull();
  }

  @Test
  void recordJobAttemptInsertsARow() {
    auditRepository.recordJobAttempt("job-1", "instance-1", "FAILURE", "boom", 2, "worker-1");

    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList("SELECT * FROM FLOWTRACE_JOB_ATTEMPT WHERE JOB_ID = ?", "job-1");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0))
        .containsEntry("PROCESS_INSTANCE_ID", "instance-1")
        .containsEntry("OUTCOME", "FAILURE")
        .containsEntry("EXCEPTION_MESSAGE", "boom")
        .containsEntry("RETRIES_LEFT", 2)
        .containsEntry("WORKER", "worker-1");
    assertThat(rows.get(0).get("ATTEMPT_AT")).isNotNull();
  }

  @Test
  void recordSequenceFlowTakenInsertsARow() {
    auditRepository.recordSequenceFlowTaken("instance-1", "flow-1");

    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_SEQUENCE_FLOW_TAKEN WHERE PROCESS_INSTANCE_ID = ?",
            "instance-1");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0)).containsEntry("SEQUENCE_FLOW_ID", "flow-1");
    assertThat(rows.get(0).get("TAKEN_AT")).isNotNull();
  }

  @Test
  void recordDeploymentActivityInsertsARow() {
    auditRepository.recordDeploymentActivity("deployment-1", "superseded", "Superseded by v2");

    List<Map<String, Object>> rows =
        jdbcTemplate.queryForList(
            "SELECT * FROM FLOWTRACE_DEPLOYMENT_ACTIVITY WHERE DEPLOYMENT_ID = ?", "deployment-1");

    assertThat(rows).hasSize(1);
    assertThat(rows.get(0))
        .containsEntry("KIND", "superseded")
        .containsEntry("DETAIL", "Superseded by v2");
    assertThat(rows.get(0).get("OCCURRED_AT")).isNotNull();
  }
}
