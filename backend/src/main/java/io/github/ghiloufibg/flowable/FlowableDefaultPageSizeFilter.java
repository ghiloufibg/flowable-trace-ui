package io.github.ghiloufibg.flowable;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.Enumeration;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.Map;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * Injects a default {@code size} query parameter onto {@code /process-api/**} requests that don't
 * already specify one, so every Flowable REST list endpoint doesn't silently fall back to
 * Flowable's own hardcoded default of 10 (confirmed directly against Flowable's {@code
 * PaginateListUtil} source - a literal in the library, not a Spring property, so there's no
 * upstream config to change this instead). Registered only when {@code flowtrace.default-page-size}
 * is configured - see {@link FlowTraceProperties}; unset means this filter is never created and
 * Flowable's own default applies exactly as it always has.
 *
 * <p>Flowable's own pagination utility doesn't cap the requested size either (verified directly
 * against its source), so a single configured value covers any real-world data volume - no
 * multi-page looping needed on either side.
 *
 * <p>Scope: only affects GET list endpoints that read {@code size} as a query parameter, which is
 * every endpoint this app's frontend actually calls. Flowable's POST "query" endpoints (e.g. {@code
 * runtime/process-instances/query}) take paging fields in a JSON body instead and are untouched by
 * this filter - not used anywhere in this app today, but worth knowing if a future consumer adds
 * one.
 */
public class FlowableDefaultPageSizeFilter extends OncePerRequestFilter {

  private final String defaultPageSize;

  public FlowableDefaultPageSizeFilter(int defaultPageSize) {
    this.defaultPageSize = String.valueOf(defaultPageSize);
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain filterChain)
      throws ServletException, IOException {
    if (request.getParameter("size") != null) {
      filterChain.doFilter(request, response);
      return;
    }
    filterChain.doFilter(new SizeDefaultingRequest(request, defaultPageSize), response);
  }

  private static final class SizeDefaultingRequest extends HttpServletRequestWrapper {
    private final String defaultSize;

    SizeDefaultingRequest(HttpServletRequest request, String defaultSize) {
      super(request);
      this.defaultSize = defaultSize;
    }

    @Override
    public String getParameter(String name) {
      if ("size".equals(name)) {
        return defaultSize;
      }
      return super.getParameter(name);
    }

    @Override
    public String[] getParameterValues(String name) {
      if ("size".equals(name)) {
        return new String[] {defaultSize};
      }
      return super.getParameterValues(name);
    }

    @Override
    public Map<String, String[]> getParameterMap() {
      Map<String, String[]> merged = new LinkedHashMap<>(super.getParameterMap());
      merged.put("size", new String[] {defaultSize});
      return Collections.unmodifiableMap(merged);
    }

    @Override
    public Enumeration<String> getParameterNames() {
      LinkedHashSet<String> names =
          new LinkedHashSet<>(Collections.list(super.getParameterNames()));
      names.add("size");
      return Collections.enumeration(names);
    }
  }
}
