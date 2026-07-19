package io.ghiloufi.flowable.audit;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;
import javax.sql.DataSource;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * Persists rows into the FLOWTRACE_* audit tables created by {@link FlowTraceSchemaInitializer}.
 */
public class AuditRepository {

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
        UUID.randomUUID().toString(),
        processInstanceId,
        executionId,
        variableName,
        variableType,
        variableValue,
        changeType,
        Timestamp.from(Instant.now()));
  }

  public void recordJobAttempt(
      String jobId,
      String processInstanceId,
      String outcome,
      String exceptionMessage,
      int retriesLeft) {
    jdbcTemplate.update(
        "INSERT INTO FLOWTRACE_JOB_ATTEMPT "
            + "(ID, JOB_ID, PROCESS_INSTANCE_ID, ATTEMPT_AT, OUTCOME, EXCEPTION_MESSAGE,"
            + " RETRIES_LEFT) VALUES (?, ?, ?, ?, ?, ?, ?)",
        UUID.randomUUID().toString(),
        jobId,
        processInstanceId,
        Timestamp.from(Instant.now()),
        outcome,
        exceptionMessage,
        retriesLeft);
  }
}
