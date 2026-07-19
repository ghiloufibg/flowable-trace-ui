package io.ghiloufi.flowable;

import io.ghiloufi.flowable.audit.AuditRepository;
import io.ghiloufi.flowable.audit.FlowTraceAuditEventListener;
import io.ghiloufi.flowable.audit.FlowTraceSchemaInitializer;
import javax.sql.DataSource;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
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

  /**
   * Registers the audit listener on the existing engine's event dispatcher - the only supported
   * runtime-attachment point, since ProcessEngineConfigurator only applies at engine-build time and
   * we never build the engine ourselves. Depends on FlowTraceSchemaMigration as a constructor
   * argument purely to make Spring create it first, guaranteeing the audit tables exist before this
   * listener can write to them.
   */
  @Bean
  public FlowTraceAuditEventListener flowTraceAuditEventListener(
      FlowTraceSchemaMigration schemaMigration) {
    AuditRepository auditRepository = new AuditRepository(schemaMigration.dataSource());
    FlowTraceAuditEventListener listener = new FlowTraceAuditEventListener(auditRepository);
    processEngine
        .getProcessEngineConfiguration()
        .getEventDispatcher()
        .addEventListener(
            listener,
            FlowableEngineEventType.VARIABLE_CREATED,
            FlowableEngineEventType.VARIABLE_UPDATED,
            FlowableEngineEventType.VARIABLE_DELETED,
            FlowableEngineEventType.JOB_EXECUTION_SUCCESS,
            FlowableEngineEventType.JOB_EXECUTION_FAILURE);
    return listener;
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
