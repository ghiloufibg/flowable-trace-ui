package io.ghiloufi.flowable.audit;

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

  private static boolean tableExists(Connection connection, String tableName) throws Exception {
    DatabaseMetaData metaData = connection.getMetaData();
    try (ResultSet resultSet = metaData.getTables(null, null, tableName, null)) {
      return resultSet.next();
    }
  }
}
