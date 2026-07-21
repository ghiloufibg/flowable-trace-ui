package io.github.ghiloufibg.flowable;

import static org.assertj.core.api.Assertions.assertThat;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

class FlowableDefaultPageSizeFilterTest {

  @Test
  void injectsTheConfiguredSizeWhenTheRequestHasNone() throws ServletException, IOException {
    FlowableDefaultPageSizeFilter filter = new FlowableDefaultPageSizeFilter(1000);
    MockHttpServletRequest request =
        new MockHttpServletRequest("GET", "/process-api/runtime/process-instances");
    MockHttpServletResponse response = new MockHttpServletResponse();
    CapturingChain chain = new CapturingChain();

    filter.doFilter(request, response, chain);

    assertThat(chain.capturedRequest.getParameter("size")).isEqualTo("1000");
    assertThat(chain.capturedRequest.getParameterValues("size")).containsExactly("1000");
    assertThat(chain.capturedRequest.getParameterMap())
        .containsEntry("size", new String[] {"1000"});
    assertThat(java.util.Collections.list(chain.capturedRequest.getParameterNames()))
        .contains("size");
  }

  @Test
  void leavesAnExplicitSizeUntouched() throws ServletException, IOException {
    FlowableDefaultPageSizeFilter filter = new FlowableDefaultPageSizeFilter(1000);
    MockHttpServletRequest request =
        new MockHttpServletRequest("GET", "/process-api/runtime/process-instances");
    request.addParameter("size", "5");
    MockHttpServletResponse response = new MockHttpServletResponse();
    CapturingChain chain = new CapturingChain();

    filter.doFilter(request, response, chain);

    assertThat(chain.capturedRequest.getParameter("size")).isEqualTo("5");
  }

  @Test
  void leavesOtherParametersIntactWhenInjectingSize() throws ServletException, IOException {
    FlowableDefaultPageSizeFilter filter = new FlowableDefaultPageSizeFilter(1000);
    MockHttpServletRequest request =
        new MockHttpServletRequest("GET", "/process-api/runtime/process-instances");
    request.addParameter("sort", "startTime");
    MockHttpServletResponse response = new MockHttpServletResponse();
    CapturingChain chain = new CapturingChain();

    filter.doFilter(request, response, chain);

    assertThat(chain.capturedRequest.getParameter("sort")).isEqualTo("startTime");
    assertThat(chain.capturedRequest.getParameter("size")).isEqualTo("1000");
  }

  private static final class CapturingChain implements FilterChain {
    private HttpServletRequest capturedRequest;

    @Override
    public void doFilter(
        jakarta.servlet.ServletRequest request, jakarta.servlet.ServletResponse response) {
      this.capturedRequest = (HttpServletRequest) request;
    }
  }
}
