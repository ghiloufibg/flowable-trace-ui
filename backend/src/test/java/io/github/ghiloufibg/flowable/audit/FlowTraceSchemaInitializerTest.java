package io.github.ghiloufibg.flowable.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.sql.Statement;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

class FlowTraceSchemaInitializerTest {

  @Test
  void resetsTheAuditTablesIntoAFreshDatabase() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:flowtrace-schema-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");

    FlowTraceSchemaInitializer.resetSchema(dataSource);

    try (Connection connection = dataSource.getConnection()) {
      assertThat(tableExists(connection, "FLOWTRACE_VARIABLE_HISTORY")).isTrue();
      assertThat(tableExists(connection, "FLOWTRACE_JOB_ATTEMPT")).isTrue();
    }
  }

  /**
   * The core new-design guarantee: a *second* reset against the exact same {@link
   * javax.sql.DataSource} within the same JVM must not destroy data the first reset's tables
   * already hold - only the first attachment gets the destructive DROP. This is what makes it safe
   * for two engine attachments (e.g. two test classes, or two beans reacting to a context refresh)
   * to share one physical database within a single test run, per the scenario matrix in
   * claudedocs/design-schema-init-ddl-reset.md.
   */
  @Test
  void secondResetAgainstTheSameDataSourceDoesNotDestroyDataFromTheFirst() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL(
        "jdbc:h2:mem:flowtrace-schema-guard-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");

    FlowTraceSchemaInitializer.resetSchema(dataSource);
    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement()) {
      statement.execute(
          "INSERT INTO FLOWTRACE_VARIABLE_HISTORY "
              + "(ID, PROCESS_INSTANCE_ID, VARIABLE_NAME, CHANGE_TYPE, CHANGED_AT) "
              + "VALUES ('row-1', 'proc-1', 'foo', 'CREATED', CURRENT_TIMESTAMP)");
    }

    // Second attachment against the same DataSource, still in this JVM: must not wipe row-1.
    FlowTraceSchemaInitializer.resetSchema(dataSource);

    try (Connection connection = dataSource.getConnection();
        Statement statement = connection.createStatement();
        ResultSet resultSet =
            statement.executeQuery(
                "SELECT COUNT(*) FROM FLOWTRACE_VARIABLE_HISTORY WHERE ID = 'row-1'")) {
      resultSet.next();
      assertThat(resultSet.getInt(1))
          .as("row written before the second reset must survive")
          .isEqualTo(1);
    }
  }

  /**
   * Proves the reset only ever touches its own FLOWTRACE_* tables by name - it doesn't scan or care
   * about other, unrelated tables already in the schema (e.g. Flowable's own ACT_* tables), unlike
   * Flyway, which used to refuse to run against a non-empty, untracked schema at all. See
   * claudedocs/design-schema-init-ddl-reset.md and claudedocs/design-flyway-schema-migration.md for
   * the history of why this mattered.
   */
  @Test
  void resetCoexistsWithUnrelatedPreExistingTables() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL(
        "jdbc:h2:mem:flowtrace-schema-preexisting-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");

    try (Connection connection = dataSource.getConnection()) {
      connection
          .createStatement()
          .execute("CREATE TABLE ACT_RU_EXECUTION (ID_ VARCHAR(64) NOT NULL, PRIMARY KEY (ID_))");
    }

    FlowTraceSchemaInitializer.resetSchema(dataSource);

    try (Connection connection = dataSource.getConnection()) {
      assertThat(tableExists(connection, "FLOWTRACE_VARIABLE_HISTORY")).isTrue();
      assertThat(tableExists(connection, "ACT_RU_EXECUTION"))
          .as("unrelated pre-existing table must be left untouched")
          .isTrue();
    }
  }

  private static boolean tableExists(Connection connection, String tableName) throws Exception {
    DatabaseMetaData metaData = connection.getMetaData();
    try (ResultSet resultSet = metaData.getTables(null, null, tableName, null)) {
      return resultSet.next();
    }
  }
}
