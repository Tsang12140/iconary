<?php
/* 把 /skills/icon-library/ 转给 api.php?action=skill，这里不放任何文案。 */
$_GET['action'] = 'skill';
/* api.php 的 baseUrl() 靠 SCRIPT_NAME 推站点根；这里掰回 api.php 的位置，
   否则它算出来的地址会变成 /skills/icon-library/api.php。 */
$_SERVER['SCRIPT_NAME'] = preg_replace('#/skills/icon-library/?[^/]*$#', '/api.php', (string)($_SERVER['SCRIPT_NAME'] ?? '/api.php'));
require __DIR__ . '/../../api.php';
