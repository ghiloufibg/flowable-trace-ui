package io.github.ghiloufibg.flowable.audit;

import javax.sql.DataSource;
import org.flywaydb.core.Flyway;

/**
 * Migrates the FLOWTRACE_* audit tables into whatever {@link DataSource} the consumer's existing
 * Flowable engine already uses, rather than adding new flowtrace.datasource.* properties -
 * guarantees the audit tables always land in the same physical database Flowable itself uses. See
 * claudedocs/backend-library-design.md §5.
 *
 * <p>Uses a dedicated Flyway instance, not Spring Boot's own auto-configured {@code Flyway} bean: a
 * separate {@code dataSource}/{@code locations}/{@code table} keeps this migration history
 * completely independent of whatever the consumer's own app does with Flyway (if anything). The
 * migration file lives at {@code classpath:flowtrace/db/migration}, deliberately *not* nested under
 * Spring Boot's default scan path {@code classpath:db/migration} - Flyway's location scanning is
 * recursive, so nesting it there would let Boot's own default-configured {@code Flyway} bean (see
 * {@link
 * io.github.ghiloufibg.flowable.FlowTraceAutoConfiguration#flowTraceFlywayConfigurationCustomizer})
 * discover and re-apply the same file under its own history table, failing with "relation already
 * exists" the second time either one runs. See claudedocs/design-flyway-schema-migration.md.
 *
 * <p>{@code baselineOnMigrate(true)} is required, not optional: without it, Flyway refuses to touch
 * a schema that already has tables it doesn't recognize (Flowable's own ACT_ and FLW_ tables) and
 * has no schema history table yet - {@code Found non-empty schema "PUBLIC" but no schema history
 * table} - exactly the failure that originally ruled out Flyway entirely (see the design doc).
 * {@code baselineVersion("0")} keeps the baseline below this module's {@code V1} migration, so
 * baselining doesn't also mark {@code V1} itself as already applied.
 */
public final class FlowTraceSchemaInitializer {

  private FlowTraceSchemaInitializer() {}

  public static void migrate(DataSource dataSource) {
    Flyway.configure()
        .dataSource(dataSource)
        .locations("classpath:flowtrace/db/migration")
        .table("flowtrace_schema_history")
        .baselineOnMigrate(true)
        .baselineVersion("0")
        .load()
        .migrate();
  }
}
