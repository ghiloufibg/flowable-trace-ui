package io.github.ghiloufibg.flowable.audit;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import java.util.UUID;
import org.h2.jdbcx.JdbcDataSource;
import org.junit.jupiter.api.Test;

class FlowTraceSchemaInitializerTest {

  @Test
  void migratesTheAuditTablesIntoAFreshDatabase() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:flowtrace-schema-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");

    FlowTraceSchemaInitializer.migrate(dataSource);

    try (Connection connection = dataSource.getConnection()) {
      assertThat(tableExists(connection, "FLOWTRACE_VARIABLE_HISTORY")).isTrue();
      assertThat(tableExists(connection, "FLOWTRACE_JOB_ATTEMPT")).isTrue();
    }
  }

  @Test
  void isIdempotentAcrossRepeatedMigrations() {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL("jdbc:h2:mem:flowtrace-schema-idempotent-" + UUID.randomUUID());

    FlowTraceSchemaInitializer.migrate(dataSource);
    FlowTraceSchemaInitializer.migrate(dataSource);
  }

  /**
   * The exact regression this class exists to avoid: Flyway refuses to touch a schema that already
   * has unrecognized tables and no schema history table yet ({@code Found non-empty schema "PUBLIC"
   * but no schema history table}) - reproduced for real against Flowable's own ACT_/FLW_ tables in
   * Phase 3, and the reason Flyway was rejected entirely before {@code baselineOnMigrate} was
   * adopted. This simulates that pre-existing, unrelated schema state without needing a real
   * Flowable engine.
   */
  @Test
  void migratesOntoASchemaThatAlreadyHasUnrelatedPreExistingTables() throws Exception {
    JdbcDataSource dataSource = new JdbcDataSource();
    dataSource.setURL(
        "jdbc:h2:mem:flowtrace-schema-preexisting-" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");

    try (Connection connection = dataSource.getConnection()) {
      connection
          .createStatement()
          .execute("CREATE TABLE ACT_RU_EXECUTION (ID_ VARCHAR(64) NOT NULL, PRIMARY KEY (ID_))");
    }

    FlowTraceSchemaInitializer.migrate(dataSource);

    try (Connection connection = dataSource.getConnection()) {
      assertThat(tableExists(connection, "FLOWTRACE_VARIABLE_HISTORY")).isTrue();
    }
  }

  private static boolean tableExists(Connection connection, String tableName) throws Exception {
    DatabaseMetaData metaData = connection.getMetaData();
    try (ResultSet resultSet = metaData.getTables(null, null, tableName, null)) {
      return resultSet.next();
    }
  }
}
