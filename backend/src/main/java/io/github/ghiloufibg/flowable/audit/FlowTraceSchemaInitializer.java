package io.github.ghiloufibg.flowable.audit;

import java.io.IOException;
import java.io.InputStream;
import java.io.UncheckedIOException;
import java.nio.charset.StandardCharsets;
import java.sql.Connection;
import java.sql.SQLException;
import java.sql.Statement;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Collectors;
import javax.sql.DataSource;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Resets the FLOWTRACE_* audit tables into whatever {@link DataSource} the consumer's existing
 * Flowable engine already uses, rather than adding new flowtrace.datasource.* properties -
 * guarantees the audit tables always land in the same physical database Flowable itself uses. See
 * claudedocs/backend-library-design.md §5.
 *
 * <p>Plain DROP+CREATE DDL, not Flyway - see claudedocs/design-schema-init-ddl-reset.md for the
 * full rationale. This data (variable-change history, job-retry history, sequence-flow-taken
 * history, deployment activity log) is debug/trace-only and reconstructable, unlike Flowable's own
 * engine tables, so it's safe - and simpler - to wipe and recreate on every attachment rather than
 * carry migration/version-history machinery for it.
 *
 * <p><b>Concurrency note</b>: a {@code DataSource} attached more than once *within the same JVM*
 * (e.g. two engines in one test run sharing one database) only gets its destructive DROP applied on
 * the first attachment - later attachments in the same JVM just ensure the tables exist, protecting
 * whatever the first attachment already wrote. This does <b>not</b> protect two *separate JVM
 * processes* attached to the same physical schema at the same moment - the same documented boundary
 * Spring Boot's own {@code schema.sql}/{@code spring.sql.init.mode=always} carries, not a new gap
 * introduced here.
 */
public final class FlowTraceSchemaInitializer {

  private static final Logger log = LoggerFactory.getLogger(FlowTraceSchemaInitializer.class);

  private static final String SCHEMA_RESOURCE = "flowtrace/schema.sql";

  private static final List<String> DROP_STATEMENTS =
      List.of(
          "DROP TABLE IF EXISTS FLOWTRACE_VARIABLE_HISTORY",
          "DROP TABLE IF EXISTS FLOWTRACE_JOB_ATTEMPT",
          "DROP TABLE IF EXISTS FLOWTRACE_SEQUENCE_FLOW_TAKEN",
          "DROP TABLE IF EXISTS FLOWTRACE_DEPLOYMENT_ACTIVITY");

  /** JDBC URLs already reset once in this JVM - guards against wiping a still-live sibling. */
  private static final Set<String> RESET_JDBC_URLS = ConcurrentHashMap.newKeySet();

  private FlowTraceSchemaInitializer() {}

  public static void resetSchema(DataSource dataSource) {
    try (Connection connection = dataSource.getConnection()) {
      String jdbcUrl = connection.getMetaData().getURL();
      boolean firstAttachmentInThisJvm = RESET_JDBC_URLS.add(jdbcUrl);

      try (Statement statement = connection.createStatement()) {
        if (firstAttachmentInThisJvm) {
          for (String drop : DROP_STATEMENTS) {
            statement.execute(drop);
          }
        } else {
          log.warn(
              "FLOWTRACE_* schema already reset once for {} in this JVM; skipping a second "
                  + "destructive reset and ensuring tables exist instead. If two engines are "
                  + "meant to be fully independent, give them separate databases.",
              jdbcUrl);
        }
        for (String create : loadCreateStatements()) {
          statement.execute(create);
        }
      }
    } catch (SQLException e) {
      throw new IllegalStateException("Failed to reset FLOWTRACE_* audit schema", e);
    }
  }

  private static List<String> loadCreateStatements() {
    try (InputStream in =
        FlowTraceSchemaInitializer.class.getClassLoader().getResourceAsStream(SCHEMA_RESOURCE)) {
      if (in == null) {
        throw new IllegalStateException(SCHEMA_RESOURCE + " not found on classpath");
      }
      String sql = new String(in.readAllBytes(), StandardCharsets.UTF_8);
      String withoutComments =
          sql.lines()
              .filter(line -> !line.strip().startsWith("--"))
              .collect(Collectors.joining("\n"));
      return Arrays.stream(withoutComments.split(";"))
          .map(String::strip)
          .filter(statement -> !statement.isEmpty())
          .toList();
    } catch (IOException e) {
      throw new UncheckedIOException("Failed to load " + SCHEMA_RESOURCE, e);
    }
  }
}
