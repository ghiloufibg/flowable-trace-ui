package io.github.ghiloufibg.flowable;

import org.flywaydb.core.Flyway;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnClass;
import org.springframework.boot.autoconfigure.flyway.FlywayConfigurationCustomizer;
import org.springframework.context.annotation.Bean;

/**
 * Split out of {@link FlowTraceAutoConfiguration} to break a circular-dependency deadlock that only
 * surfaces when a consumer also enables Flowable's JPA integration (i.e. has both {@code
 * spring-boot-starter-data-jpa} and Flowable's own {@code jpaProcessEngineConfigurer} active).
 *
 * <p>{@link FlowTraceAutoConfiguration} requires a {@link org.flowable.engine.ProcessEngine}
 * constructor argument, so Spring can't invoke any of its {@code @Bean} methods - including one
 * contributing this {@link FlywayConfigurationCustomizer} - without first fully resolving that
 * constructor. In a JPA-integrated consumer, resolving {@code ProcessEngine} transitively requires
 * {@code entityManagerFactory}, which requires Boot's {@code flyway} bean to run first (standard
 * Spring Boot ordering), which requires every {@code FlywayConfigurationCustomizer} bean in the
 * context - including the one on {@code FlowTraceAutoConfiguration} - closing the cycle:
 * entityManagerFactory -&gt; flyway -&gt; FlowTraceAutoConfiguration -&gt; processEngine -&gt;
 * jpaProcessEngineConfigurer -&gt; entityManagerFactory.
 *
 * <p>This customizer never touches {@code ProcessEngine} at all, so hosting it on a separate
 * auto-configuration class with no such constructor dependency lets Boot construct it - and
 * therefore Flyway, and therefore entityManagerFactory - without waiting on the process engine,
 * breaking the cycle. See {@code claudedocs/design-flyway-schema-migration.md}.
 */
@AutoConfiguration
@ConditionalOnClass(Flyway.class)
public class FlowTraceFlywayAutoConfiguration {

  /**
   * Adding flyway-core as a real dependency means Spring Boot's own {@code FlywayAutoConfiguration}
   * now also auto-activates in every consumer app that has a DataSource bean - completely
   * independent of {@code FlowTraceSchemaInitializer}'s own dedicated Flyway instance. Left at its
   * defaults, that separate bean fails startup outright the moment Flowable's pre-existing ACT_ and
   * FLW_ tables are in the same schema with no schema history table yet. This customizer (Spring
   * Boot's own supported extension point for the bean it auto-configures) only sets {@code
   * baselineOnMigrate}, never touching {@code locations}/{@code table}, so a consumer's own Flyway
   * migrations (if any) still run through Boot's bean exactly as they would without this library on
   * the classpath.
   */
  @Bean
  public FlywayConfigurationCustomizer flowTraceFlywayConfigurationCustomizer() {
    return configuration -> configuration.baselineOnMigrate(true).baselineVersion("0");
  }
}
