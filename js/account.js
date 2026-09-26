// 读者账户系统:纯前端实现,基于 localStorage,每个设备一个账户
// 功能:用户名、头像、关注博主、评论标识、点赞记录
(function () {
  'use strict';

  var KEY = 'blog-reader-account';

  function empty() {
    return { name: '', avatar: '', bio: '', site: '', following: false, likes: [], joinDate: '' };
  }

  function load() {
    try {
      var data = JSON.parse(localStorage.getItem(KEY) || '{}');
      var acc = empty();
      Object.keys(acc).forEach(function (k) { if (data[k] !== undefined) acc[k] = data[k]; });
      return acc;
    } catch (e) {
      return empty();
    }
  }

  function save(acc) {
    try {
      localStorage.setItem(KEY, JSON.stringify(acc));
    } catch (e) { /* 忽略 */ }
  }

  function isLoggedIn() {
    return !!load().name;
  }

  function login(name, avatar) {
    var acc = load();
    acc.name = name.trim();
    if (avatar) acc.avatar = avatar;
    if (!acc.joinDate) acc.joinDate = new Date().toISOString().slice(0, 10);
    save(acc);
  }

  function logout() {
    var acc = empty();
    save(acc);
  }

  function setAvatar(dataUrl) {
    var acc = load();
    acc.avatar = dataUrl;
    save(acc);
  }

  function setBio(bio) {
    var acc = load();
    acc.bio = bio;
    save(acc);
  }

  function toggleFollow() {
    var acc = load();
    acc.following = !acc.following;
    save(acc);
    return acc.following;
  }

  function recordLike(key) {
    var acc = load();
    if (acc.likes.indexOf(key) === -1) {
      acc.likes.push(key);
      save(acc);
    }
  }

  function hasLiked(key) {
    return load().likes.indexOf(key) !== -1;
  }

  function getAvatar() {
    var acc = load();
    return acc.avatar || 'assets/avatar-default.jpg';
  }

  function getName() {
    var acc = load();
    return acc.name || '';
  }

  function isOwner() {
    try {
      return Number(localStorage.getItem('blog-auth') || 0) > Date.now();
    } catch (e) {
      return false;
    }
  }

  function displayName() {
    if (isOwner()) return 'HSH(站长)';
    var name = getName();
    return name || '访客';
  }

  var ReaderAccount = {
    load: load,
    save: save,
    login: login,
    logout: logout,
    setAvatar: setAvatar,
    setBio: setBio,
    toggleFollow: toggleFollow,
    recordLike: recordLike,
    hasLiked: hasLiked,
    getAvatar: getAvatar,
    getName: getName,
    isLoggedIn: isLoggedIn,
    isOwner: isOwner,
    displayName: displayName
  };

  window.ReaderAccount = ReaderAccount;
})();
