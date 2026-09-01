/*
 * 90-day uptime bars for the Upptime status page (status.claude.com style).
 *
 * Loaded via `status-website.scripts` in .upptimerc.yml. Upptime's own
 * LiveStatus component renders one <article> per site inside
 * section.live-status; this appends a daily bar strip to each of them and
 * uptime-bars.css hides the response-time line graph behind the card.
 *
 * Data comes from the same files the status page already reads:
 *   history/summary.json  -> dailyMinutesDown, a date -> minutes-down map
 *   history/<slug>.yml    -> startTime, when this site was first monitored
 * Days before startTime are drawn as "no data" rather than as uptime.
 */
(function () {
  "use strict";

  var OWNER = "goalsmapper";
  var REPO = "uptime-status";
  var BRANCH = "master";
  var RAW = "https://raw.githubusercontent.com/" + OWNER + "/" + REPO + "/" + BRANCH;

  var DAYS = 90;
  var MINUTES_PER_DAY = 1440;
  // A day with at most this much downtime reads as partial rather than down.
  var DEGRADED_MAX_MINUTES = 60;

  var summaryPromise = null;
  var startTimePromises = {};

  function fetchSummary() {
    if (!summaryPromise) {
      summaryPromise = fetch(RAW + "/history/summary.json", { cache: "no-cache" })
        .then(function (res) {
          return res.ok ? res.json() : [];
        })
        .catch(function () {
          return [];
        });
    }
    return summaryPromise;
  }

  function fetchStartTime(slug) {
    if (!startTimePromises[slug]) {
      startTimePromises[slug] = fetch(RAW + "/history/" + slug + ".yml", { cache: "no-cache" })
        .then(function (res) {
          return res.ok ? res.text() : "";
        })
        .then(function (text) {
          var match = /^startTime:\s*(.+)$/m.exec(text);
          if (!match) return null;
          var date = new Date(match[1].trim());
          return isNaN(date.getTime()) ? null : date;
        })
        .catch(function () {
          return null;
        });
    }
    return startTimePromises[slug];
  }

  /* Upptime writes dailyMinutesDown keys in UTC, so bucket by UTC day too. */
  function utcMidnight(date) {
    return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }

  function dayKey(timestamp) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  function formatDay(timestamp) {
    return new Date(timestamp).toLocaleDateString(undefined, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric"
    });
  }

  function formatDowntime(minutes) {
    if (minutes >= MINUTES_PER_DAY) return "down all day";
    if (minutes >= 60) {
      var hours = Math.floor(minutes / 60);
      var rest = minutes % 60;
      return rest ? hours + "h " + rest + "m down" : hours + "h down";
    }
    return minutes + " min down";
  }

  function buildStrip(site, startDate) {
    var minutesDown = site.dailyMinutesDown || {};
    var today = utcMidnight(new Date());
    var firstTracked = startDate ? utcMidnight(startDate) : null;

    var track = document.createElement("div");
    track.className = "gm-bars-track";

    var trackedDays = 0;
    var totalMinutesDown = 0;

    for (var i = DAYS - 1; i >= 0; i--) {
      var day = today - i * 86400000;
      var bar = document.createElement("span");
      bar.className = "gm-bar";

      if (firstTracked !== null && day < firstTracked) {
        bar.classList.add("gm-bar--nodata");
        bar.setAttribute("data-label", formatDay(day) + " · No data");
      } else {
        var minutes = minutesDown[dayKey(day)] || 0;
        trackedDays++;
        totalMinutesDown += minutes;

        if (minutes === 0) {
          bar.classList.add("gm-bar--up");
          bar.setAttribute("data-label", formatDay(day) + " · No downtime");
        } else if (minutes <= DEGRADED_MAX_MINUTES) {
          bar.classList.add("gm-bar--degraded");
          bar.setAttribute("data-label", formatDay(day) + " · " + formatDowntime(minutes));
        } else {
          bar.classList.add("gm-bar--down");
          bar.setAttribute("data-label", formatDay(day) + " · " + formatDowntime(minutes));
        }
      }

      track.appendChild(bar);
    }

    var legend = document.createElement("div");
    legend.className = "gm-bars-legend";

    var from = document.createElement("span");
    // Don't claim 90 days of coverage for a site we started watching last week.
    from.textContent =
      firstTracked !== null && firstTracked > today - (DAYS - 1) * 86400000
        ? "Since " + formatDay(firstTracked)
        : DAYS + " days ago";

    var uptime = document.createElement("span");
    uptime.className = "gm-bars-uptime";
    if (trackedDays) {
      var percent = Math.max(0, 100 - (totalMinutesDown / (trackedDays * MINUTES_PER_DAY)) * 100);
      uptime.textContent = percent.toFixed(2) + "% uptime";
    } else {
      uptime.textContent = "No data yet";
    }

    var to = document.createElement("span");
    to.textContent = "Today";

    legend.appendChild(from);
    legend.appendChild(uptime);
    legend.appendChild(to);

    var wrapper = document.createElement("div");
    wrapper.className = "gm-bars";
    wrapper.appendChild(track);
    wrapper.appendChild(legend);
    return wrapper;
  }

  function slugFor(article) {
    var link = article.querySelector('a[href*="/history/"]');
    if (!link) return null;
    var match = /\/history\/([^/?#]+)/.exec(link.getAttribute("href") || "");
    return match ? decodeURIComponent(match[1]) : null;
  }

  function decorate() {
    var articles = document.querySelectorAll("section.live-status article:not([data-gm-bars])");
    if (!articles.length) return;

    fetchSummary().then(function (sites) {
      Array.prototype.forEach.call(articles, function (article) {
        if (article.hasAttribute("data-gm-bars")) return;

        var slug = slugFor(article);
        if (!slug) return;

        var site = null;
        for (var i = 0; i < sites.length; i++) {
          if (sites[i].slug === slug) {
            site = sites[i];
            break;
          }
        }
        if (!site) return;

        article.setAttribute("data-gm-bars", "");
        fetchStartTime(slug).then(function (startDate) {
          if (article.querySelector(".gm-bars")) return;
          article.appendChild(buildStrip(site, startDate));
        });
      });
    });
  }

  function init() {
    decorate();

    // Upptime renders the cards client-side after its own fetch resolves, and
    // re-renders them when the 24h/7d/30d duration is switched.
    var scheduled = false;
    new MutationObserver(function () {
      if (scheduled) return;
      scheduled = true;
      setTimeout(function () {
        scheduled = false;
        decorate();
      }, 50);
    }).observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
