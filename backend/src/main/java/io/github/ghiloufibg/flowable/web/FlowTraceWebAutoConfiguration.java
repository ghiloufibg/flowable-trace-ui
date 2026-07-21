package io.github.ghiloufibg.flowable.web;

import io.github.ghiloufibg.flowable.FlowTraceProperties;
import org.springframework.boot.autoconfigure.AutoConfiguration;
import org.springframework.boot.autoconfigure.condition.ConditionalOnResource;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.core.io.ClassPathResource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Serves the embedded frontend build (copied into META-INF/resources/flow-trace-ui/ by
 * backend/pom.xml's copy-frontend-static-resources execution) at {@code flowtrace.mount-path}
 * (default {@code /flow-trace}), with SPA fallback for client-side routes. Gated on the resources
 * actually being present rather than on ProcessEngine, so a consumer that excludes the frontend
 * assets (e.g. a headless/API-only build) doesn't register a dead resource handler - see
 * claudedocs/backend-library-design.md §8.
 */
@AutoConfiguration
@ConditionalOnResource(resources = "classpath:/META-INF/resources/flow-trace-ui/index.html")
@EnableConfigurationProperties(FlowTraceProperties.class)
public class FlowTraceWebAutoConfiguration implements WebMvcConfigurer {

  private static final String RESOURCE_LOCATION = "classpath:/META-INF/resources/flow-trace-ui/";

  private final FlowTraceProperties properties;

  public FlowTraceWebAutoConfiguration(FlowTraceProperties properties) {
    this.properties = properties;
  }

  @Override
  public void addResourceHandlers(ResourceHandlerRegistry registry) {
    ClassPathResource indexHtml =
        new ClassPathResource("META-INF/resources/flow-trace-ui/index.html");
    registry
        .addResourceHandler(properties.getMountPath() + "/**")
        .addResourceLocations(RESOURCE_LOCATION)
        .resourceChain(true)
        .addResolver(new SpaResourceResolver(indexHtml));
  }

  /**
   * The resource handler above only ever sees non-empty paths under the mount prefix (it handles
   * deep client-side routes correctly via SpaResourceResolver); a bare request for the mount root
   * itself (with or without a trailing slash) needs an explicit forward to index.html since
   * Spring's resource handling treats a trailing-slash-only path as outside the resource chain
   * rather than an empty relative path.
   */
  @Override
  public void addViewControllers(ViewControllerRegistry registry) {
    String indexPath = properties.getMountPath() + "/index.html";
    registry.addViewController(properties.getMountPath()).setViewName("forward:" + indexPath);
    registry.addViewController(properties.getMountPath() + "/").setViewName("forward:" + indexPath);
  }
}
