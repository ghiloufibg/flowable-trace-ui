package io.github.ghiloufibg.flowable;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.ghiloufibg.flowable.rest.DefinitionEnrichmentController;
import io.github.ghiloufibg.flowable.rest.DeploymentEnrichmentController;
import io.github.ghiloufibg.flowable.rest.InstanceEnrichmentController;
import io.github.ghiloufibg.flowable.rest.JobEnrichmentController;
import io.github.ghiloufibg.flowable.rest.JobHealthController;
import java.util.UUID;
import org.flowable.engine.HistoryService;
import org.flowable.engine.ManagementService;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
import org.flowable.engine.RepositoryService;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.TaskService;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

class FlowTraceAutoConfigurationTest {

  private final ApplicationContextRunner contextRunner =
      new ApplicationContextRunner()
          .withConfiguration(AutoConfigurations.of(FlowTraceAutoConfiguration.class));

  /**
   * Each test gets its own uniquely named in-memory H2 database (createStandaloneInMem... hardcodes
   * jdbc:h2:mem:flowable otherwise). Engines are intentionally never closed: Flowable 7.1's
   * schema-drop script hits a stricter DROP ordering rule in H2 2.x (Spring Boot's managed version)
   * on close, which is a version-compatibility rough edge, not a real failure — the in-memory DB
   * disappears with the JVM fork regardless.
   */
  private static ProcessEngine buildTestProcessEngine() {
    return ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()
        .setJdbcUrl("jdbc:h2:mem:flowtrace-test-" + UUID.randomUUID())
        .buildProcessEngine();
  }

  @Test
  void doesNotActivateWithoutAProcessEngineBean() {
    contextRunner.run(
        context -> {
          assertThat(context).doesNotHaveBean(FlowTraceAutoConfiguration.class);
        });
  }

  @Test
  void activatesAgainstAnExistingProcessEngineBean() {
    ProcessEngine testProcessEngine = buildTestProcessEngine();

    // A real Flowable-Spring integration exposes these as beans automatically; this lightweight
    // context has to register them explicitly so the enrichment controllers' @Bean methods
    // (which depend on them) can be autowired.
    contextRunner
        .withBean(ProcessEngine.class, () -> testProcessEngine)
        .withBean(RepositoryService.class, testProcessEngine::getRepositoryService)
        .withBean(RuntimeService.class, testProcessEngine::getRuntimeService)
        .withBean(TaskService.class, testProcessEngine::getTaskService)
        .withBean(HistoryService.class, testProcessEngine::getHistoryService)
        .withBean(ManagementService.class, testProcessEngine::getManagementService)
        .run(
            context -> {
              assertThat(context).hasSingleBean(FlowTraceAutoConfiguration.class);
              assertThat(context).hasSingleBean(FlowTraceProperties.class);
              assertThat(context)
                  .getBean(FlowTraceAutoConfiguration.FlowTraceActivationMarker.class)
                  .extracting(
                      FlowTraceAutoConfiguration.FlowTraceActivationMarker::processEngineName)
                  .isEqualTo(testProcessEngine.getName());
              assertThat(context).hasSingleBean(DeploymentEnrichmentController.class);
              assertThat(context).hasSingleBean(DefinitionEnrichmentController.class);
              assertThat(context).hasSingleBean(JobHealthController.class);
              assertThat(context).hasSingleBean(JobEnrichmentController.class);
              assertThat(context).hasSingleBean(InstanceEnrichmentController.class);
            });
  }

  @Test
  void doesNotActivateWhenExplicitlyDisabled() {
    ProcessEngine testProcessEngine = buildTestProcessEngine();

    contextRunner
        .withBean(ProcessEngine.class, () -> testProcessEngine)
        .withPropertyValues("flowtrace.enabled=false")
        .run(context -> assertThat(context).doesNotHaveBean(FlowTraceAutoConfiguration.class));
  }

  @Test
  void doesNotRegisterTheDefaultPageSizeFilterWhenThePropertyIsUnset() {
    ProcessEngine testProcessEngine = buildTestProcessEngine();

    contextRunner
        .withBean(ProcessEngine.class, () -> testProcessEngine)
        .withBean(RepositoryService.class, testProcessEngine::getRepositoryService)
        .withBean(RuntimeService.class, testProcessEngine::getRuntimeService)
        .withBean(TaskService.class, testProcessEngine::getTaskService)
        .withBean(HistoryService.class, testProcessEngine::getHistoryService)
        .withBean(ManagementService.class, testProcessEngine::getManagementService)
        .run(
            context ->
                assertThat(context)
                    .doesNotHaveBean(
                        org.springframework.boot.web.servlet.FilterRegistrationBean.class));
  }

  @Test
  void registersTheDefaultPageSizeFilterWhenThePropertyIsSet() {
    ProcessEngine testProcessEngine = buildTestProcessEngine();

    contextRunner
        .withBean(ProcessEngine.class, () -> testProcessEngine)
        .withBean(RepositoryService.class, testProcessEngine::getRepositoryService)
        .withBean(RuntimeService.class, testProcessEngine::getRuntimeService)
        .withBean(TaskService.class, testProcessEngine::getTaskService)
        .withBean(HistoryService.class, testProcessEngine::getHistoryService)
        .withBean(ManagementService.class, testProcessEngine::getManagementService)
        .withPropertyValues("flowtrace.default-page-size=500")
        .run(
            context -> {
              assertThat(context)
                  .hasSingleBean(org.springframework.boot.web.servlet.FilterRegistrationBean.class);
              var registration =
                  context.getBean(
                      org.springframework.boot.web.servlet.FilterRegistrationBean.class);
              assertThat(registration.getUrlPatterns()).containsExactly("/process-api/*");
            });
  }
}
