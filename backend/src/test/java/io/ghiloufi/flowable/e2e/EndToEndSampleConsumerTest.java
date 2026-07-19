package io.ghiloufi.flowable.e2e;

import static org.assertj.core.api.Assertions.assertThat;

import io.ghiloufi.flowable.FlowTraceAutoConfiguration;
import io.ghiloufi.flowable.rest.InstanceEnrichmentController;
import java.util.HashMap;
import java.util.Map;
import org.flowable.engine.ProcessEngine;
import org.flowable.engine.RuntimeService;
import org.flowable.engine.runtime.ProcessInstance;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.context.ApplicationContext;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Phase 9 - end-to-end validation. Every other backend test either builds a ProcessEngine manually
 * (ProcessEngineConfiguration.createStandaloneInMemProcessEngineConfiguration()) or exercises a
 * single piece in isolation. This test is the one that proves the assembled system works the way a
 * real consumer actually uses it: add flow-trace-ui-backend as a dependency, bring your own
 * Flowable starter, let Spring Boot's own auto-configuration discovery wire everything together
 * (FlowTraceAutoConfiguration activating via META-INF/spring/...AutoConfiguration.imports, not a
 * test double).
 *
 * <p>The engine here is bootstrapped entirely by flowable-spring-boot-starter-process-rest's own
 * Spring Boot auto-configuration - nothing in this test constructs a ProcessEngine directly. The
 * process is auto-deployed from src/test/resources/processes/ (Flowable's default
 * classpath*:/processes/ location), exactly as a real consumer app would deploy their own
 * processes.
 */
@SpringBootTest(
    classes = EndToEndSampleConsumerTest.SampleConsumerApp.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class EndToEndSampleConsumerTest {

  @Autowired private TestRestTemplate restTemplate;

  @Autowired private RuntimeService runtimeService;

  @Autowired private ApplicationContext applicationContext;

  /**
   * Directly guards the @AutoConfigureOrder(LOWEST_PRECEDENCE) fix documented on
   * FlowTraceAutoConfiguration: without it, this whole auto-configuration silently doesn't activate
   * against a ProcessEngine bean that Spring Boot's own starter registers (as opposed to one
   * pre-registered manually via ApplicationContextRunner.withBean(...), which every other backend
   * test uses and which sidesteps auto-configuration ordering entirely).
   */
  @Test
  void flowTraceAutoConfigurationActivatesAgainstTheRealBootstrappedEngine() {
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
  void enrichmentApiWorksAgainstTheRealBootstrappedEngine() {
    Map<String, Object> variables = new HashMap<>();
    variables.put("orderId", "E2E-1001");
    ProcessInstance instance =
        runtimeService.startProcessInstanceByKey("orderApprovalE2E", "E2E-1001", variables);

    ResponseEntity<String> response =
        restTemplate.getForEntity("/custom/instances/" + instance.getId(), String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("E2E-1001").contains("orderApprovalE2E");
  }

  @Test
  void embeddedFrontendIsServedByTheSameApp() {
    ResponseEntity<String> response = restTemplate.getForEntity("/flow-trace/", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("Flowable Console").contains("id=\"root\"");
  }

  @Test
  void jobHealthEndpointRespondsWithAggregateCounts() {
    ResponseEntity<String> response =
        restTemplate.getForEntity("/custom/jobs/health", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody())
        .contains("timers")
        .contains("async")
        .contains("dead")
        .contains("locked");
  }

  @SpringBootApplication
  static class SampleConsumerApp {}
}
