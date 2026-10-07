(function () {
  'use strict';

  var contributors = ['HSHSpaceX', 'aleistercrowleybeast666'];
  var state = {
    byAuthorDate: {},
    years: [],
    selectedAuthor: 'all',
    selectedYear: new Date().getFullYear(),
    loading: false
  };

  function level(count) {
    if (count === 0) return 0;
    if (count <= 2) return 1;
    if (count <= 4) return 2;
    if (count <= 6) return 3;
    return 4;
  }

  function commitDate(commit) {
    return (commit.commit && commit.commit.author && commit.commit.author.date)
      || (commit.commit && commit.commit.committer && commit.commit.committer.date)
      || '';
  }

  function commitAuthor(commit) {
    return (commit.author && commit.author.login)
      || (commit.committer && commit.committer.login)
      || 'unknown';
  }

  function buildData(commits) {
    state.byAuthorDate = { all: {} };
    state.years = [];
    var earliestYear = null;
    commits.forEach(function (commit) {
      var value = commitDate(commit);
      if (!value) return;
      var date = value.slice(0, 10);
      var year = Number(date.slice(0, 4));
      var author = commitAuthor(commit);
      state.byAuthorDate.all[date] = (state.byAuthorDate.all[date] || 0) + 1;
      state.byAuthorDate[author] = state.byAuthorDate[author] || {};
      state.byAuthorDate[author][date] = (state.byAuthorDate[author][date] || 0) + 1;
      if (state.years.indexOf(year) === -1) state.years.push(year);
      if (earliestYear === null || year < earliestYear) earliestYear = year;
    });
    var currentYear = new Date().getFullYear();
    if (earliestYear === null) earliestYear = currentYear;
    for (var year = earliestYear; year <= currentYear; year++) {
      if (state.years.indexOf(year) === -1) state.years.push(year);
    }
    state.years.sort(function (a, b) { return b - a; });
  }

  function renderYears() {
    var rail = document.getElementById('contribYears');
    if (!rail) return;
    rail.innerHTML = state.years.map(function (year) {
      return '<button class="contrib-year-button' + (year === state.selectedYear ? ' is-active' : '') + '" data-year="' + year + '" type="button">' + year + '</button>';
    }).join('');
  }

  function renderPills() {
    document.querySelectorAll('.contrib-pill').forEach(function (pill) {
      pill.classList.toggle('is-active', pill.dataset.author === state.selectedAuthor);
    });
  }

  function renderChart() {
    var wrap = document.getElementById('contribCells');
    if (!wrap) return;
    var counts = state.byAuthorDate[state.selectedAuthor] || {};
    var days = [];
    var start = new Date(state.selectedYear, 0, 1);
    var end = new Date(state.selectedYear, 11, 31);
    for (var date = new Date(start); date <= end; date.setDate(date.getDate() + 1)) {
      var key = date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0') + '-' + String(date.getDate()).padStart(2, '0');
      days.push({ date: key, count: counts[key] || 0 });
    }
    var weeks = [];
    var week = [];
    days.forEach(function (day, index) {
      week.push(day);
      if (week.length === 7 || index === days.length - 1) {
        weeks.push(week);
        week = [];
      }
    });
    wrap.innerHTML = weeks.map(function (items) {
      return '<div class="contrib-week">' + items.map(function (day) {
        return '<div class="contrib-day" data-level="' + level(day.count) + '" data-tip="' + day.date + '：' + day.count + ' 次提交"></div>';
      }).join('') + '</div>';
    }).join('');
    bindTooltips(wrap);
  }

  function render() {
    renderYears();
    renderPills();
    renderChart();
  }

  function tooltip() {
    var tip = document.querySelector('.contrib-tooltip');
    if (tip) return tip;
    tip = document.createElement('div');
    tip.className = 'contrib-tooltip';
    document.body.appendChild(tip);
    return tip;
  }

  function positionTip(event, tip) {
    var left = event.clientX + 12;
    var top = event.clientY - 36;
    var rect = tip.getBoundingClientRect();
    if (left + rect.width + 12 > window.innerWidth) left = window.innerWidth - rect.width - 12;
    if (top < 8) top = event.clientY + 14;
    tip.style.left = left + 'px';
    tip.style.top = top + 'px';
  }

  function bindTooltips(wrap) {
    if (wrap.dataset.tooltipBound === '1') return;
    wrap.dataset.tooltipBound = '1';
    var tip = tooltip();
    wrap.addEventListener('mouseover', function (event) {
      var cell = event.target.closest('.contrib-day[data-tip]');
      if (!cell) return;
      tip.textContent = cell.dataset.tip;
      tip.classList.add('is-visible');
      positionTip(event, tip);
    });
    wrap.addEventListener('mousemove', function (event) {
      if (!tip.classList.contains('is-visible')) return;
      positionTip(event, tip);
    });
    wrap.addEventListener('mouseleave', function () {
      tip.classList.remove('is-visible');
    });
  }

  function setAuthor(author) {
    state.selectedAuthor = state.selectedAuthor === author ? 'all' : author;
    render();
  }

  function setYear(year) {
    state.selectedYear = Number(year);
    render();
  }

  function checkYear() {
    var currentYear = new Date().getFullYear();
    if (state.selectedYear === currentYear) return;
    state.selectedYear = currentYear;
    if (state.years.indexOf(currentYear) === -1) {
      state.years.unshift(currentYear);
      state.years.sort(function (a, b) { return b - a; });
    }
    render();
  }

  function fetchPage(page, collected) {
    return fetch('https://api.github.com/repos/HSHSpaceX/personal-blog/commits?per_page=100&page=' + page, { cache: 'no-store' })
      .then(function (response) { return response.json(); })
      .then(function (items) {
        if (!Array.isArray(items) || !items.length) return collected;
        collected = collected.concat(items);
        if (items.length < 100 || page >= 50) return collected;
        return fetchPage(page + 1, collected);
      });
  }

  function load() {
    if (state.loading) return;
    state.loading = true;
    var wrap = document.getElementById('contribCells');
    if (wrap) wrap.innerHTML = '<p class="empty-state">正在加载贡献图…</p>';
    fetchPage(1, [])
      .then(function (commits) {
        buildData(commits);
        state.selectedYear = new Date().getFullYear();
        render();
      })
      .catch(function () {
        if (wrap) wrap.innerHTML = '<p class="empty-state">暂时无法加载贡献图。</p>';
      })
      .finally(function () { state.loading = false; });
  }

  function init() {
    document.querySelectorAll('.contrib-pill').forEach(function (pill) {
      pill.addEventListener('click', function () { setAuthor(pill.dataset.author); });
    });
    document.getElementById('contribYears').addEventListener('click', function (event) {
      var button = event.target.closest('.contrib-year-button');
      if (button) setYear(button.dataset.year);
    });
    load();
    window.setInterval(checkYear, 60000);
    window.setInterval(load, 300000);
  }

  init();
})();
