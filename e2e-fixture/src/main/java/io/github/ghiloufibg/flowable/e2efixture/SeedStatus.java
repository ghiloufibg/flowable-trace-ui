package io.github.ghiloufibg.flowable.e2efixture;

import java.util.concurrent.atomic.AtomicBoolean;
import org.springframework.stereotype.Component;

/**
 * Flips to ready only once {@link E2eFixtureApp}'s seed runner has finished - see {@link
 * ReadyController}.
 */
@Component
public class SeedStatus {

  private final AtomicBoolean ready = new AtomicBoolean(false);

  public void markReady() {
    ready.set(true);
  }

  public boolean isReady() {
    return ready.get();
  }
}
