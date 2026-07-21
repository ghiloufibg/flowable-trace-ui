package io.github.ghiloufibg.flowable.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Persists rows into the FLOWTRACE_* audit tables created by {@link FlowTraceSchemaInitializer}.
 */
public class AuditRepository {

  /**
   * {@code FLOWTRACE_VARIABLE_HISTORY.CHANGE_TYPE} values - produced by {@link
   * FlowTraceAuditEventListener}, filtered on by {@code InstanceEnrichmentController} when reading
   * history back. Shared here so the two sides can't silently drift apart.
   */
  public static final String VARIABLE_CHANGE_CREATED = "CREATED";

  public static final String VARIABLE_CHANGE_UPDATED = "UPDATED";
  public static final String VARIABLE_CHANGE_DELETED = "DELETED";

  private final JdbcTemplate jdbcTemplate;

  public AuditRepository(DataSource dataSource) {
    this.jdbcTemplate = new JdbcTemplate(dataSource);
  }

  public void recordVariableChange(
      String processInstanceId,
      String executionId,
      String variableName,
      String variableType,
      String variableValue,
      String changeType) {
    jdbcTemplate.update(
        "INSERT INTO FLOWTRACE_VARIABLE_HISTORY "
            + "(ID, PROCESS_INSTANCE_ID, EXECUTION_ID, VARIABLE_NAME, VARIABLE_TYPE,"
            + " VARIABLE_VALUE, CHANGE_TYPE, CHANGED_AT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        newId(),
        processInstanceId,
        executionId,
        variableName,
        variableType,
        variableValue,
        changeType,
        now());
  }

  public void recordJobAttempt(
      String jobId,
      String processInstanceId,
      String outcome,
      String exceptionMessage,
      int retriesLeft,
      String worker) {
    jdbcTemplate.update(
        "INSERT INTO FLOWTRACE_JOB_ATTEMPT "
            + "(ID, JOB_ID, PROCESS_INSTANCE_ID, ATTEMPT_AT, OUTCOME, EXCEPTION_MESSAGE,"
            + " RETRIES_LEFT, WORKER) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        newId(),
        jobId,
        processInstanceId,
        now(),
        outcome,
        exceptionMessage,
        retriesLeft,
        worker);
  }

  public void recordSequenceFlowTaken(String processInstanceId, String sequenceFlowId) {
    jdbcTemplate.update(
        "INSERT INTO FLOWTRACE_SEQUENCE_FLOW_TAKEN "
            + "(ID, PROCESS_INSTANCE_ID, SEQUENCE_FLOW_ID, TAKEN_AT) VALUES (?, ?, ?, ?)",
        newId(),
        processInstanceId,
        sequenceFlowId,
        now());
  }

  public void recordDeploymentActivity(String deploymentId, String kind, String detail) {
    jdbcTemplate.update(
        "INSERT INTO FLOWTRACE_DEPLOYMENT_ACTIVITY "
            + "(ID, DEPLOYMENT_ID, KIND, DETAIL, OCCURRED_AT) VALUES (?, ?, ?, ?, ?)",
        newId(),
        deploymentId,
        kind,
        detail,
        now());
  }

  private static String newId() {
    return UUID.randomUUID().toString();
  }

  private static Timestamp now() {
    return Timestamp.from(Instant.now());
  }
}
