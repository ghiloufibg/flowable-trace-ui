package io.github.ghiloufibg.flowable.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import io.github.ghiloufibg.flowable.FlowTraceAutoConfiguration;
import io.github.ghiloufibg.flowable.rest.InstanceEnrichmentController;
import java.util.HashMap;
import java.util.Map;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.junit.jupiter.api.Tag;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.testcontainers.containers.PostgreSQLContainer;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;

/**
 * Same assembled-system scenario as {@link EndToEndSampleConsumerTest} (Phase 9), against real
 * PostgreSQL instead of the default H2 fallback - H2 can mask SQL dialect issues, and nothing else
 * exercises the whole system (auto-configuration activation, {@code /process-api/**}, {@code
 * /custom/**} enrichment, {@code FlowTraceSchemaMigration}, the audit-trail listener) against a
 * real database; {@link io.github.ghiloufibg.flowable.audit.FlowTraceSchemaInitializerPostgresTest} only
 * covers the schema migration in isolation. See claudedocs/design-backend-postgres-smoke-test.md.
 *
 * <p>Tagged {@code smoke} - excluded from the default {@code mvn verify} run (see backend/pom.xml)
 * and run instead by CI's dedicated {@code backend-smoke} job, which is guaranteed to have Docker
 * available (unlike a contributor's own machine, which is why this doesn't skip gracefully the way
 * {@code FlowTraceSchemaInitializerPostgresTest} does - this class's whole purpose is a CI job
 * where that assumption always holds).
 */
@Tag("smoke")
@Testcontainers
@SpringBootTest(
    classes = EndToEndSampleConsumerPostgresSmokeTest.SampleConsumerApp.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EndToEndSampleConsumerPostgresSmokeTest {

  @Container
  static PostgreSQLContainer<?> postgres = new PostgreSQLContainer<>("postgres:16-alpine");

  @DynamicPropertySource
  static void datasource(DynamicPropertyRegistry registry) {
    registry.add("spring.datasource.url", postgres::getJdbcUrl);
    registry.add("spring.datasource.username", postgres::getUsername);
    registry.add("spring.datasource.password", postgres::getPassword);
  }

  @Autowired private TestRestTemplate restTemplate;

  @Autowired private RuntimeService runtimeService;

  @Autowired private ApplicationContext applicationContext;

  @Test
  void flowTraceAutoConfigurationActivatesAgainstARealPostgresBackedEngine() {
    assertThat(applicationContext.getBeanNamesForType(ProcessEngine.class)).hasSize(1);
    assertThat(applicationContext.getBeanNamesForType(FlowTraceAutoConfiguration.class)).hasSize(1);
    assertThat(applicationContext.getBeanNamesForType(InstanceEnrichmentController.class))
        .hasSize(1);
  }

  @Test
  void officialFlowableRestApiListsTheAutoDeployedProcessDefinition() {
    ResponseEntity<String> response =
        restTemplate.getForEntity("/process-api/repository/process-definitions", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("orderApprovalE2E");
  }

  @Test
  void enrichmentApiWorksAgainstARealPostgresBackedEngine() {
    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", "E2E-PG-1001");
    ProcessInstance instance =
        runtimeService.startProcessInstanceByKey("orderApprovalE2E", "E2E-PG-1001", variables);

    ResponseEntity<String> response =
        restTemplate.getForEntity("/custom/instances/" + instance.getId(), String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("E2E-PG-1001").contains("orderApprovalE2E");
  }

  /**
   * Same check as {@link EndToEndSampleConsumerTest#embeddedFrontendIsServedByTheSameApp()} -
   * repeated here rather than assumed, since a Postgres-specific regression (e.g. a
   * FlowTraceSchemaMigration failure blocking the rest of auto-configuration, including
   * FlowTraceWebAutoConfiguration) could plausibly take the frontend down even though nothing about
   * static resource serving is Postgres-specific itself.
   */
  @Test
  void embeddedFrontendIsServedByTheSameApp() {
    ResponseEntity<String> response = restTemplate.getForEntity("/flow-trace/", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("Flowable Console").contains("id=\"root\"");
  }

  @SpringBootApplication
  static class SampleConsumerApp {}
}
