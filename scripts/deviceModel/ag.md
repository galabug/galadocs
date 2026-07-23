## 手机型号转换需求
- 源文件 `scripts/deviceModel/models.csv` . 目标文件 `scripts/deviceModel/设备型号转译.xlsx` 
- 写一个脚本，把源文件里的设备型号转换成目标文件格式的设备型号，增量型号数据 输出到 `设备型号转译.年月.xlsx`
- 转换逻辑：
    1.目标文件为初始文件，读取初始文件和所有月份文件增量内容，然后去重生成新的设备型号增量内容；
    2.只获取手机和pad的设备型号，名称里含有字样 `电脑/笔记本/游戏本/MagicBook/MateBook/翻译机/座舱/汽车/四足机器人` 的也过滤掉；
    3.新增型号的yc_id生成规则 8位数字 yyMM+4个数字顺序生成；
    4.设备型号唯一，去重只保存一条记录；
    5.苹果的手机型号=源文件的`code_alias`，安卓的手机型号=源文件的`model`；
    6.同一个品牌名称的保持 同一个规则 都是中文 或者都是英文，具体以目标文件为准；
    7.品牌名统一 HUAWEI->华为 HONOR->荣耀 Sony->索尼 Samsung->三星；
    8.realme 品牌，名称中的 真我 替换成 realme，名称未包含 品牌名 的，补上前缀 `品牌名+一个空格`；
    9.360 品牌，，名称未包含 品牌名 的，补上前缀 `品牌名+一个空格`；
    10.努比亚 品牌，名称未包含 品牌名者红魔 的 ，补上前缀 `品牌名+一个空格`；
    11.vivo 品牌，名称未包含 品牌名者IQOO 的 ，补上前缀 `品牌名+一个空格`；
    12.索尼 品牌，名称未包含 品牌名者sony 的 ，补上前缀 `sony+一个空格`；
    13.名称规则包括pad的名称也适用；
    14.同时生成tidb数据库的sql文件`yc_DeviceModelIntoName.年月.sql`，每200条一个批量插入，单条sql如下:
    `insert into yc_DeviceModelIntoName (YC_ID,YC_CREATEDDATE,YC_NAME,YC_MODEL,YC_BRAND) values (26070001,NULL,'iPhone 7 Plus','iPhone9,2','Apple');`