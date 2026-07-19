package io.ghiloufi.flowable;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.UUID;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.ProcessEngineConfiguration;
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

    contextRunner
        .withBean(ProcessEngine.class, () -> testProcessEngine)
        .run(
            context -> {
              assertThat(context).hasSingleBean(FlowTraceAutoConfiguration.class);
              assertThat(context).hasSingleBean(FlowTraceProperties.class);
              assertThat(context)
                  .getBean(FlowTraceAutoConfiguration.FlowTraceActivationMarker.class)
                  .extracting(
                      FlowTraceAutoConfiguration.FlowTraceActivationMarker::processEngineName)
                  .isEqualTo(testProcessEngine.getName());
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
}
