package io.github.ghiloufibg.flowable.audit;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assumptions.assumeTrue;

import com.zaxxer.hikari.HikariConfig;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.DatabaseMetaData;
import java.sql.ResultSet;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.testcontainers.DockerClientFactory;
import org.testcontainers.containers.PostgreSQLContainer;

/**
 * Validates the audit migration against real PostgreSQL, not just H2 - H2 can mask SQL dialect
 * issues (per claudedocs/backend-library-design.md §10). Skips gracefully when Docker isn't
 * available (e.g. this dev environment has the Docker CLI but no running daemon) rather than
 * failing the build; CI environments with Docker will actually exercise it.
 *
 * <p>Tagged {@code smoke} - excluded from the default {@code mvn verify} run (see backend/pom.xml)
 * and run instead by CI's dedicated {@code backend-smoke} job, which - unlike a contributor's own
 * machine - is guaranteed to have Docker available. See
 * claudedocs/design-backend-postgres-smoke-test.md.
 */
@Tag("smoke")
class FlowTraceSchemaInitializerPostgresTest {

  private static PostgreSQLContainer<?> postgres;
  private static HikariDataSource dataSource;

  @BeforeAll
  static void startContainer() {
    assumeTrue(DockerClientFactory.instance().isDockerAvailable(), "Docker is not available");

    postgres = new PostgreSQLContainer<>("postgres:16-alpine");
    postgres.start();

    HikariConfig config = new HikariConfig();
    config.setJdbcUrl(postgres.getJdbcUrl());
    config.setUsername(postgres.getUsername());
    config.setPassword(postgres.getPassword());
    dataSource = new HikariDataSource(config);
  }

  @AfterAll
  static void stopContainer() {
    if (dataSource != null) {
      dataSource.close();
    }
    if (postgres != null) {
      postgres.stop();
    }
  }

  @Test
  void migratesTheAuditTablesIntoRealPostgres() throws Exception {
    FlowTraceSchemaInitializer.migrate(dataSource);

    try (Connection connection = dataSource.getConnection()) {
      DatabaseMetaData metaData = connection.getMetaData();
      assertThat(tableExists(metaData, "flowtrace_variable_history")).isTrue();
      assertThat(tableExists(metaData, "flowtrace_job_attempt")).isTrue();
    }
  }

  private static boolean tableExists(DatabaseMetaData metaData, String tableName) throws Exception {
    try (ResultSet resultSet = metaData.getTables(null, null, tableName, null)) {
      return resultSet.next();
    }
  }
}
