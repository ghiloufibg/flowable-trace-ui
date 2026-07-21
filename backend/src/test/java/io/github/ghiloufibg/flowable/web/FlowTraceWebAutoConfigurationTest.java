package io.github.ghiloufibg.flowable.web;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.core.io.Resource;
import org.springframework.core.io.support.PathMatchingResourcePatternResolver;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

/**
 * FlowTraceWebAutoConfiguration is gated only on the embedded frontend resources existing
 * (@ConditionalOnResource), not on a ProcessEngine bean - so this test needs nothing but a plain
 * Spring Boot web app with the backend jar's auto-configuration on the classpath.
 */
@SpringBootTest(
    classes = FlowTraceWebAutoConfigurationTest.MinimalApp.class,
    webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class FlowTraceWebAutoConfigurationTest {

  @Autowired private TestRestTemplate restTemplate;

  @Test
  void servesTheIndexHtmlAtTheMountPathRoot() {
    ResponseEntity<String> response = restTemplate.getForEntity("/flow-trace/", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("Flowable Console").contains("id=\"root\"");
  }

  @Test
  void fallsBackToIndexHtmlForADeepClientSideRoute() {
    ResponseEntity<String> response =
        restTemplate.getForEntity("/flow-trace/instances/PI-does-not-matter", String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).contains("Flowable Console").contains("id=\"root\"");
  }

  @Test
  void servesRealStaticAssetsDirectlyWithoutFallingBackToIndexHtml() throws IOException {
    Resource[] cssAssets =
        new PathMatchingResourcePatternResolver()
            .getResources("classpath:/META-INF/resources/flow-trace-ui/assets/*.css");
    assertThat(cssAssets)
        .as("expected the frontend build to produce at least one CSS asset")
        .isNotEmpty();
    String assetFileName = cssAssets[0].getFilename();

    ResponseEntity<String> response =
        restTemplate.getForEntity("/flow-trace/assets/" + assetFileName, String.class);

    assertThat(response.getStatusCode()).isEqualTo(HttpStatus.OK);
    assertThat(response.getBody()).doesNotContain("id=\"root\"");
  }

  @SpringBootApplication
  static class MinimalApp {}
}
