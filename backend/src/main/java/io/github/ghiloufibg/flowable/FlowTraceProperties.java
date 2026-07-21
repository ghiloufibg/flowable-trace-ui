package io.github.ghiloufibg.flowable;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * {@link ConfigurationProperties @ConfigurationProperties} for the embedded flow-trace-ui backend.
 */
@ConfigurationProperties(prefix = "flowtrace")
public class FlowTraceProperties {

  private boolean enabled = true;

  private String mountPath = "/flow-trace";

  /**
   * Injected as a default {@code size} query param on any {@code /process-api/**} request that
   * doesn't already specify one - see {@link FlowableDefaultPageSizeFilter}. Deliberately left
   * {@code null} (not defaulted to a number here): when unset, no filter is registered at all and
   * Flowable's own hardcoded default of 10 (from its {@code PaginateListUtil}, not a Spring
   * property) applies exactly as it always has - this class never duplicates that value.
   */
  private Integer defaultPageSize;

  public boolean isEnabled() {
    return enabled;
  }

  public void setEnabled(boolean enabled) {
    this.enabled = enabled;
  }

  public String getMountPath() {
    return mountPath;
  }

  public void setMountPath(String mountPath) {
    this.mountPath = mountPath;
  }

  public Integer getDefaultPageSize() {
    return defaultPageSize;
  }

  public void setDefaultPageSize(Integer defaultPageSize) {
    this.defaultPageSize = defaultPageSize;
  }
}
