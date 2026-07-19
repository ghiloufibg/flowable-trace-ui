package io.ghiloufi.flowable.audit;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import javax.sql.DataSource;

/**
 * Creates the FLOWTRACE_* audit tables in whatever {@link DataSource} the consumer's existing
 * Flowable engine already uses, rather than adding new flowtrace.datasource.* properties -
 * guarantees the audit tables always land in the same physical database Flowable itself uses. See
 * claudedocs/backend-library-design.md §5.
 *
 * <p>Deliberately hand-rolled instead of using Flyway: Flyway's mere presence on the classpath
 * (Spring Boot's FlywayAutoConfiguration is {@code @ConditionalOnClass(Flyway.class)}) makes Spring
 * Boot auto-activate its OWN Flyway migration against the consumer app's main DataSource, which
 * breaks in any consumer that doesn't already use Flyway themselves - Flowable's own pre-existing
 * tables look like a "non-empty schema with no schema history table" to that unrelated
 * auto-configuration. Since this library must never assume how a consumer manages their own schema
 * tooling, it avoids putting Flyway on their classpath at all.
 */
public final class FlowTraceSchemaInitializer {

  private static final String CREATE_VARIABLE_HISTORY_TABLE =
      """
      CREATE TABLE FLOWTRACE_VARIABLE_HISTORY (
          ID VARCHAR(64) NOT NULL,
          PROCESS_INSTANCE_ID VARCHAR(64) NOT NULL,
          EXECUTION_ID VARCHAR(64),
          VARIABLE_NAME VARCHAR(255) NOT NULL,
          VARIABLE_TYPE VARCHAR(100),
          VARIABLE_VALUE TEXT,
          CHANGE_TYPE VARCHAR(20) NOT NULL,
          CHANGED_AT TIMESTAMP NOT NULL,
          PRIMARY KEY (ID)
      )
      """;

  private static final String CREATE_VARIABLE_HISTORY_INDEX =
      "CREATE INDEX IDX_FLOWTRACE_VAR_HIST_PROC_INST ON FLOWTRACE_VARIABLE_HISTORY"
          + " (PROCESS_INSTANCE_ID)";

  private static final String CREATE_JOB_ATTEMPT_TABLE =
      """
      CREATE TABLE FLOWTRACE_JOB_ATTEMPT (
          ID VARCHAR(64) NOT NULL,
          JOB_ID VARCHAR(64) NOT NULL,
          PROCESS_INSTANCE_ID VARCHAR(64),
          ATTEMPT_AT TIMESTAMP NOT NULL,
          DURATION_MS BIGINT,
          OUTCOME VARCHAR(20) NOT NULL,
          EXCEPTION_MESSAGE TEXT,
          RETRIES_LEFT INTEGER,
          PRIMARY KEY (ID)
      )
      """;

  private static final String CREATE_JOB_ATTEMPT_INDEX =
      "CREATE INDEX IDX_FLOWTRACE_JOB_ATTEMPT_JOB ON FLOWTRACE_JOB_ATTEMPT (JOB_ID)";

  private FlowTraceSchemaInitializer() {}

  public static void migrate(DataSource dataSource) {
    try (Connection connection = dataSource.getConnection()) {
      createTableIfMissing(
          connection,
          "FLOWTRACE_VARIABLE_HISTORY",
          CREATE_VARIABLE_HISTORY_TABLE,
          CREATE_VARIABLE_HISTORY_INDEX);
      createTableIfMissing(
          connection, "FLOWTRACE_JOB_ATTEMPT", CREATE_JOB_ATTEMPT_TABLE, CREATE_JOB_ATTEMPT_INDEX);
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to create flow-trace-ui audit tables", e);
    }
  }

  private static void createTableIfMissing(Connection connection, String tableName, String... ddl)
      throws SQLException {
    if (tableExists(connection, tableName)) {
      return;
    }
    try (Statement statement = connection.createStatement()) {
      for (String statementSql : ddl) {
        statement.execute(statementSql);
      }
    }
  }

  private static boolean tableExists(Connection connection, String tableName) throws SQLException {
    DatabaseMetaData metaData = connection.getMetaData();
    // Unquoted identifiers fold to uppercase in H2 but lowercase in PostgreSQL by default;
    // check both rather than relying on one database's convention.
    if (tableFound(metaData, tableName.toUpperCase())) {
      return true;
    }
    return tableFound(metaData, tableName.toLowerCase());
  }

  private static boolean tableFound(DatabaseMetaData metaData, String tableName)
      throws SQLException {
    try (ResultSet resultSet = metaData.getTables(null, null, tableName, null)) {
      return resultSet.next();
    }
  }
}
