/* 待审核评论：读者提交后暂存在这里，博主在后台“消息”中审核。 */
window.PendingComments = {
  ENDPOINT: 'https://textdb.dev/api/data/shiguang-pending-v1',
  list: function () {
    return fetch(this.ENDPOINT + '?t=' + Date.now())
      .then(function (res) { return res.text(); })
      .then(function (text) {
        try {
          var data = JSON.parse(text || '[]');
          return Array.isArray(data) ? data : [];
        } catch (e) {
          return [];
        }
      })
      .catch(function () {
        return [];
      });
  },
  save: function (items) {
    return fetch(this.ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(items, null, 2)
    });
  },
  add: function (item) {
    var self = this;
    return this.list().then(function (list) {
      list.push(item);
      return self.save(list);
    });
  },
  remove: function (id) {
    var self = this;
    return this.list().then(function (list) {
      return self.save(list.filter(function (item) {
        return item.id !== id;
      }));
    });
  }
};
