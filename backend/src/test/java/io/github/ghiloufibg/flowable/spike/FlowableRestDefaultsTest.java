package io.github.ghiloufibg.flowable.spike;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * Answers design-doc open decision #1: does flowable-spring-boot-starter-process-rest force Spring
 * Security Basic-auth on its own, independent of our own library? Spins up nothing but that starter
 * (plus H2) and hits its real REST endpoint directly. No FlowTraceAutoConfiguration involved — this
 * is purely about the upstream Flowable starter's own default behavior.
 */
@SpringBootTest(
    classes = FlowableRestDefaultsTest.MinimalFlowableRestApp.class,
    webEnvironment = WebEnvironment.RANDOM_PORT,
    properties = "flowable.database-schema-update=true")
class FlowableRestDefaultsTest {

  @Test
  void processApiIsReachableWithoutCredentialsByDefault(
      @org.springframework.beans.factory.annotation.Autowired TestRestTemplate restTemplate) {
    ResponseEntity<String> response =
        restTemplate.getForEntity("/process-api/repository/process-definitions", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
  }

  @SpringBootApplication
  static class MinimalFlowableRestApp {}
}
