package io.ghiloufi.flowable;

import io.ghiloufi.flowable.audit.FlowTraceSchemaInitializer;
import javax.sql.DataSource;
import org.flowable.engine.ProcessEngine;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;

/**
 * Activates only when a {@link ProcessEngine} bean already exists in the context. Never creates one
 * itself — see decision #4 in claudedocs/backend-library-design.md.
 */
@AutoConfiguration
@ConditionalOnClass(ProcessEngine.class)
@ConditionalOnBean(ProcessEngine.class)
@ConditionalOnProperty(
    prefix = "flowtrace",
    name = "enabled",
    havingValue = "true",
    matchIfMissing = true)
@EnableConfigurationProperties(FlowTraceProperties.class)
public class FlowTraceAutoConfiguration {

  private static final Logger log = LoggerFactory.getLogger(FlowTraceAutoConfiguration.class);

  private final ProcessEngine processEngine;
  private final FlowTraceProperties properties;

  public FlowTraceAutoConfiguration(ProcessEngine processEngine, FlowTraceProperties properties) {
    this.processEngine = processEngine;
    this.properties = properties;
  }

  @Bean
  public FlowTraceActivationMarker flowTraceActivationMarker() {
    return new FlowTraceActivationMarker(processEngine.getName());
  }

  /**
   * Migrates the FLOWTRACE_* audit tables into whatever DataSource the existing ProcessEngine
   * already uses - reusing it directly (rather than adding new flowtrace.datasource.* properties)
   * guarantees the audit tables always land in the same physical database Flowable itself uses. See
   * decision in claudedocs/backend-library-design.md §5.
   */
  @Bean
  public FlowTraceSchemaMigration flowTraceSchemaMigration() {
    DataSource dataSource = processEngine.getProcessEngineConfiguration().getDataSource();
    FlowTraceSchemaInitializer.migrate(dataSource);
    return new FlowTraceSchemaMigration(dataSource);
  }

  @EventListener(ContextRefreshedEvent.class)
  public void logActivation() {
    log.info(
        "flow-trace-ui-backend activated for ProcessEngine '{}', mounted at {}",
        processEngine.getName(),
        properties.getMountPath());
  }

  /** Marker bean proving the auto-configuration activated, used by tests. */
  public record FlowTraceActivationMarker(String processEngineName) {}

  /** Marker bean proving the audit schema migration ran, used by tests. */
  public record FlowTraceSchemaMigration(DataSource dataSource) {}
}
