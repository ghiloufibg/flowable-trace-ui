package io.ghiloufi.flowable;

import io.ghiloufi.flowable.audit.AuditRepository;
import io.ghiloufi.flowable.audit.FlowTraceAuditEventListener;
import io.ghiloufi.flowable.audit.FlowTraceSchemaInitializer;
import io.ghiloufi.flowable.rest.DefinitionEnrichmentController;
import io.ghiloufi.flowable.rest.DeploymentEnrichmentController;
import io.ghiloufi.flowable.rest.InstanceEnrichmentController;
import io.ghiloufi.flowable.rest.JobEnrichmentController;
import io.ghiloufi.flowable.rest.JobHealthController;
import javax.sql.DataSource;
import org.flowable.common.engine.api.delegate.event.FlowableEngineEventType;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.AutoConfigureOrder;
import org.springframework.boot.autoconfigure.condition.ConditionalOnBean;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.event.ContextRefreshedEvent;
import org.springframework.context.event.EventListener;
import org.springframework.core.Ordered;

/**
 * Activates only when a {@link ProcessEngine} bean already exists in the context. Never creates one
 * itself — see decision #4 in claudedocs/backend-library-design.md.
 *
 * <p>{@code @AutoConfigureOrder(Ordered.LOWEST_PRECEDENCE)} is required, not optional: without some
 * ordering hint, Spring Boot has no guarantee this class is evaluated after whichever Flowable
 * auto-configuration class actually registers the {@code ProcessEngine} bean definition, so
 * {@code @ConditionalOnBean(ProcessEngine.class)} can see no bean yet and silently never activate -
 * even though the bean exists once the context has fully refreshed. An earlier attempt used
 * {@code @AutoConfigureAfter(ProcessEngineAutoConfiguration.class)} targeting that specific class;
 * empirically (via Spring Boot's condition evaluation report, {@code -Ddebug=true}) that did NOT
 * fix it - Flowable's internal {@code @Import} structure for engine bean registration isn't
 * something worth hard-coding a specific class against.
 * {@code @AutoConfigureOrder(LOWEST_PRECEDENCE)} sorts this class into the last priority group
 * among all auto-configurations, which reliably runs after Flowable's (unordered, default-
 * priority) auto-configuration classes regardless of which one specifically creates the bean -
 * confirmed by rerunning Phase 9's end-to-end test after switching to it.
 *
 * <p>This was missed entirely by every earlier test, which all pre-registered a {@code
 * ProcessEngine} bean directly via {@code ApplicationContextRunner.withBean(...)}, sidestepping
 * auto-configuration ordering altogether. Only Phase 9's real end-to-end test (a full Spring Boot
 * app that bootstraps its own engine via {@code flowable-spring-boot-starter-process-rest}, the way
 * a real consumer actually uses this library) caught the gap: the official Flowable REST API and
 * the embedded frontend both worked, but every {@code custom/**} endpoint 404'd because this whole
 * auto-configuration had silently not activated.
 */
@AutoConfiguration
@AutoConfigureOrder(Ordered.LOWEST_PRECEDENCE)
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
            FlowableEngineEventType.JOB_EXECUTION_FAILURE,
            FlowableEngineEventType.SEQUENCEFLOW_TAKEN);
    return listener;
  }

  /**
   * The custom/** enrichment controllers (see claudedocs/backend-library-design.md §7.2). These
   * plain @RestController classes aren't picked up by component scanning (this is a library, not
   * the consumer's own base package), so each is registered explicitly here rather than relying
   * on @ComponentScan.
   */
  @Bean
  public DeploymentEnrichmentController flowTraceDeploymentEnrichmentController(
      RepositoryService repositoryService) {
    return new DeploymentEnrichmentController(repositoryService);
  }

  @Bean
  public DefinitionEnrichmentController flowTraceDefinitionEnrichmentController(
      RepositoryService repositoryService) {
    return new DefinitionEnrichmentController(repositoryService);
  }

  @Bean
  public JobHealthController flowTraceJobHealthController(ManagementService managementService) {
    return new JobHealthController(managementService);
  }

  @Bean
  public JobEnrichmentController flowTraceJobEnrichmentController(
      ManagementService managementService,
      RepositoryService repositoryService,
      RuntimeService runtimeService,
      HistoryService historyService) {
    return new JobEnrichmentController(
        managementService, repositoryService, runtimeService, historyService, processEngine);
  }

  @Bean
  public InstanceEnrichmentController flowTraceInstanceEnrichmentController(
      RepositoryService repositoryService,
      RuntimeService runtimeService,
      TaskService taskService,
      HistoryService historyService,
      ManagementService managementService) {
    return new InstanceEnrichmentController(
        repositoryService,
        runtimeService,
        taskService,
        historyService,
        managementService,
        processEngine);
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
