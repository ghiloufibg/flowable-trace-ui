package io.ghiloufi.flowable.e2efixture;

import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * CI polls this instead of a generic port/health check: the embedded servlet container starts
 * accepting connections before {@link E2eFixtureApp}'s seed runner finishes, so "is the port open"
 * alone would let Playwright start against incomplete data.
 */
@RestController
public class ReadyController {

  private final SeedStatus seedStatus;

  public ReadyController(SeedStatus seedStatus) {
    this.seedStatus = seedStatus;
  }

  @GetMapping("/e2e-ready")
  public ResponseEntity<String> ready() {
    if (seedStatus.isReady()) {
      return ResponseEntity.ok("{\"ready\":true}");
    }
    return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body("{\"ready\":false}");
  }
}
