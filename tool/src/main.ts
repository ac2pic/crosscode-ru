/* eslint-disable no-loop-func */

import {
  ChapterStatus,
  ChapterStatuses,
  ChapterStatusesObj,
  Fragment,
  NotaClient,
  Original,
  generateFragmentDescriptionText,
  getChapterNameOfFile,
  stringifyFragmentOriginal,
} from './Notabenoid.js';
import {
  IGNORE_IN_MOD_TAG,
  INJECTED_IN_MOD_TAG,
  LocalizeMePacker,
} from './TranslationPack.js';
import { readSettings, writeSettings } from './settings.js';
import {
  CHAPTER_FRAGMENTS_DIR,
  CHAPTER_STATUSES_FILE,
  LOCALIZE_ME_MAPPING_FILE,
  LOCALIZE_ME_PACKS_DIR,
  MOD_DATA_DIR,
} from './paths.js';

import fs from './node-builtin-modules/fs.js';
import * as fsUtils from './utils/fs.js';
import paths from './node-builtin-modules/path.js';

import * as asyncUtils from './utils/async.js';
import * as iteratorUtils from './utils/iterator.js';
import * as miscUtils from './utils/misc.js';

declare global {
  var app: Main; // eslint-disable-line no-var
}

window.addEventListener('load', () => {
  let app = new Main();
  window.app = app;
  void app.start();
});

const LEA_PHRASES = new Map([
  ['???', '???'],
  ['????', '????'],
  ['...', '...'],
  ['.\\..\\..', '.\\..\\..'],
  ['...!', '...!'],
  ['...!!', '...!!'],
  ['...?', '...?'],
  ['...?!', '...?!'],
  ['...!?', '...!?'],
  ['[nods]', '[кивает]'],
  ['[shakes head]', '[мотает головой]'],
  ['Hi!', 'Привет!'],
  ['Hi?', 'Привет?'],
  ['Hi.', 'Привет.'],
  ['Why?', 'Почему?'],
  ['How?', 'Как?'],
  ['Bye!', 'Пока!'],
  ['Bye.', 'Пока.'],
  ['Thanks!', 'Спасибо!'],
  ['Lea!', 'Лея!'],
  ['[yes]', '[да]'],
  ['[no]', '[нет]'],
]);

class Main {
  public notaClient = new NotaClient();
  public progressBar = new ProgressBar();

  public async start(): Promise<void> {
    try {
      await fs.promises.mkdir(MOD_DATA_DIR, { recursive: true });

      let settings = await readSettings();

      let autoOpenCheckbox = document.getElementById(
        'settings_translations_autoOpen',
      )! as HTMLInputElement;
      autoOpenCheckbox.disabled = false;
      autoOpenCheckbox.checked = settings.autoOpen;
      autoOpenCheckbox.addEventListener('change', () => {
        settings.autoOpen = autoOpenCheckbox.checked;
        void writeSettings(settings);
      });

      await showDevTools();

      let updateButton = document.getElementById(
        'settings_translations_update',
      )! as HTMLButtonElement;
      updateButton.disabled = false;
      updateButton.addEventListener('click', () => {
        void this.downloadTranslations(false);
      });

      let redownloadButton = document.getElementById(
        'settings_translations_redownload',
      )! as HTMLButtonElement;
      redownloadButton.disabled = false;
      redownloadButton.addEventListener('click', () => {
        void this.downloadTranslations(true);
      });
    } catch (err) {
      console.error(err);
    }
  }

  public async autoTranslateCommonPhrases(): Promise<void> {
    let chapterStatuses: ChapterStatuses = await this.readChapterStatuses();
    let chapterFragments = new Map<string, Fragment[]>();
    let allChapterFragmentsCount = 0;
    for (let [i, name] of iteratorUtils.enumerate(chapterStatuses.keys())) {
      this.progressBar.setTaskInfo(`Чтение главы '${name}' с диска...`);
      this.progressBar.setValue(i, chapterStatuses.size);

      let fragments: Fragment[] = await fsUtils.readJsonFile(
        paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
      );
      chapterFragments.set(name, fragments);
      allChapterFragmentsCount += fragments.length;
    }
    this.progressBar.setDone();

    const autoTranslate = async (
      chapterId: string,
      f: Fragment,
    ): Promise<void> => {
      if (f.translations.length > 0) return;

      let translation = LEA_PHRASES.get(f.original.text);
      if (translation == null) return;

      await this.notaClient.addFragmentTranslation(
        chapterId,
        f.id,
        translation,
      );
    };

    let fixedFragmentsCount = 0;
    for (let chapterStatus of chapterStatuses.values()) {
      this.progressBar.setTaskInfo(chapterStatus.name);
      let fragments = chapterFragments.get(chapterStatus.name)!;
      let chapterId = chapterStatus.id;

      for (let fragment of fragments) {
        this.progressBar.setValue(
          fixedFragmentsCount,
          allChapterFragmentsCount,
        );
        await autoTranslate(chapterId, fragment);
        fixedFragmentsCount++;
      }
    }
    this.progressBar.setTaskInfo('');
    this.progressBar.setDone();
  }

  public async fixFragmentOriginals(): Promise<void> {
    let chapterStatuses: ChapterStatuses = await this.readChapterStatuses();
    let chapterFragments = new Map<string, Fragment[]>();
    let allChapterFragmentsCount = 0;
    for (let [i, name] of iteratorUtils.enumerate(chapterStatuses.keys())) {
      this.progressBar.setTaskInfo(`Чтение главы '${name}' с диска...`);
      this.progressBar.setValue(i, chapterStatuses.size);

      let fragments: Fragment[] = await fsUtils.readJsonFile(
        paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
      );
      chapterFragments.set(name, fragments);
      allChapterFragmentsCount += fragments.length;
    }
    this.progressBar.setDone();

    let assetsCache = new Map<string, Promise<unknown>>();
    const fixOriginal = async (
      chapterId: string,
      f: Fragment,
    ): Promise<void> => {
      if (
        f.original.descriptionText.includes(IGNORE_IN_MOD_TAG) ||
        f.original.descriptionText.includes(INJECTED_IN_MOD_TAG)
      ) {
        return;
      }

      let { file: filePath, jsonPath: jsonPathStr } = f.original;

      let promise: Promise<unknown>;
      if (assetsCache.has(filePath)) {
        promise = assetsCache.get(filePath)!;
      } else {
        promise = fsUtils.readJsonFileOptional(paths.join('assets', filePath));
        assetsCache.set(filePath, promise);
      }

      let fileData = await promise;
      if (fileData == null) {
        console.warn(`${filePath} ${jsonPathStr}: unknown file`);
        await this.notaClient.addFragmentTranslation(
          chapterId,
          f.id,
          'tr_ru:ERR_REMOVED_FROM_GAME',
        );
        return;
      }
      let isLangFile =
        filePath.startsWith(paths.normalize('data/lang/')) &&
        filePath.endsWith('.en_US.json');

      let jsonPath = jsonPathStr.split('/');
      let obj = miscUtils.getValueByPath(fileData, jsonPath);
      if (obj != null) {
        f.original.descriptionText = !isLangFile
          ? generateFragmentDescriptionText(jsonPath, fileData)
          : '';
      }

      let realOriginalText: string | null = null;
      if (isLangFile) {
        if (typeof obj === 'string') realOriginalText = obj;
      } else if (
        miscUtils.isObject(obj) &&
        miscUtils.hasKey(obj, 'en_US') &&
        typeof obj.en_US === 'string'
      ) {
        realOriginalText = obj.en_US;
      }

      if (realOriginalText == null) {
        console.warn(`${filePath} ${jsonPathStr}: not a string`);
        await this.notaClient.addFragmentTranslation(
          chapterId,
          f.id,
          'tr_ru:ERR_REMOVED_FROM_GAME',
        );
        return;
      }

      if (f.original.text !== realOriginalText) {
        console.warn(`${filePath} ${jsonPathStr}: stale original`);
        await this.notaClient.addFragmentTranslation(
          chapterId,
          f.id,
          `tr_ru:ERR_STALE_ORIGINAL\n\n${f.original.text}`,
        );
      }
      f.original.text = realOriginalText;

      let newRawText = stringifyFragmentOriginal(f.original);
      if (newRawText !== f.original.rawContent) {
        await this.notaClient.editFragmentOriginal(
          chapterId,
          f.id,
          f.orderNumber,
          newRawText,
        );
      }
    };

    let fixedFragmentsCount = 0;

    for (let chapterStatus of chapterStatuses.values()) {
      this.progressBar.setTaskInfo(chapterStatus.name);
      let fragments = chapterFragments.get(chapterStatus.name)!;
      let chapterId = chapterStatus.id;

      let iterator = function* (this: Main) {
        for (let fragment of fragments) {
          this.progressBar.setValue(
            fixedFragmentsCount,
            allChapterFragmentsCount,
          );
          yield fixOriginal(chapterId, fragment);
          fixedFragmentsCount++;
        }
      }.call(this);

      await asyncUtils.limitConcurrency(iterator, 16);
    }

    this.progressBar.setTaskInfo('');
    this.progressBar.setDone();
  }

  public async uploadNewFragments(): Promise<void> {
    let chapterStatuses: ChapterStatuses = await this.readChapterStatuses();
    let chapterFragments = new Map<string, Fragment[]>();
    // arrays are used as pointers for the sake of updating max order numbers
    // by reference instead of performing a lookup in `Map#set` every time
    let chapterMaxOrderNumbers = new Map<string, [number]>();
    for (let [i, name] of iteratorUtils.enumerate(chapterStatuses.keys())) {
      this.progressBar.setTaskInfo(`Чтение главы '${name}' с диска...`);
      this.progressBar.setValue(i, chapterStatuses.size);

      let fragments: Fragment[] = await fsUtils.readJsonFile(
        paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
      );
      chapterFragments.set(name, fragments);

      let maxOrderNum = 0;
      for (let f of fragments) {
        maxOrderNum = Math.max(maxOrderNum, f.orderNumber);
      }
      chapterMaxOrderNumbers.set(name, [maxOrderNum]);
    }
    this.progressBar.setDone();

    this.progressBar.setIndeterminate();
    this.progressBar.setTaskInfo(`Поиск файлов...`);
    let filePaths: string[] = [];
    for (let jsonDir of ['data', 'extension']) {
      for await (let path of fsUtils.findFilesRecursively(
        paths.join('assets', jsonDir),
      )) {
        if (path.endsWith('.json')) {
          filePaths.push(paths.join(jsonDir, path));
          this.progressBar.setTaskInfo(`Найдено файлов: ${filePaths.length}`);
        }
      }
    }
    filePaths.sort();
    this.progressBar.setDone();

    for (let [i, filePath] of filePaths.entries()) {
      this.progressBar.setTaskInfo(filePath);
      this.progressBar.setValue(i, filePaths.length);

      let isLangFile = filePath.startsWith(paths.normalize('data/lang/'));
      if (isLangFile && !filePath.endsWith('.en_US.json')) continue;

      let data = await fsUtils.readJsonFile(paths.join('assets', filePath));

      let iterator = isLangFile
        ? findStringsInLangFileObject((data as { labels: unknown }).labels, [
            'labels',
          ])
        : findLangLabelsInObject(data);

      let chapterName = getChapterNameOfFile(filePath);
      let chapterId = chapterStatuses.get(chapterName)!.id;
      let thisChapterFragments = chapterFragments.get(chapterName)!;
      let chapterMaxOrderNumber = chapterMaxOrderNumbers.get(chapterName)!;

      for (let langLabel of iterator) {
        if (isLangLabelIgnored(langLabel, filePath)) continue;

        let jsonPathStr = langLabel.jsonPath.join('/');
        if (
          thisChapterFragments.some(
            ({ original: o }) =>
              o.file === filePath && o.jsonPath === jsonPathStr,
          )
        ) {
          continue;
        }

        let orig: Original = {
          rawContent: '',
          file: filePath,
          jsonPath: jsonPathStr,
          langUid: langLabel.langUid,
          descriptionText: !isLangFile
            ? generateFragmentDescriptionText(langLabel.jsonPath, data)
            : '',
          text: langLabel.text,
        };
        orig.rawContent = stringifyFragmentOriginal(orig);
        console.warn(chapterName, orig.rawContent);

        chapterMaxOrderNumber[0]++;
        console.warn(`${filePath} ${jsonPathStr}: new fragment`);
        await this.notaClient.addFragmentOriginal(
          chapterId,
          chapterMaxOrderNumber[0],
          orig.rawContent,
        );
      }
    }
    this.progressBar.setDone();

    this.progressBar.setTaskInfo('');
  }

  public async fixFragmentOrder(): Promise<void> {
    let chapterStatuses: ChapterStatuses = await this.readChapterStatuses();
    let chapterFragments = new Map<string, Fragment[]>();
    let allChapterFragmentsCount = 0;
    // arrays are used as pointers for the sake of updating max order numbers
    // by reference instead of performing a lookup in `Map#set` every time
    let chapterMaxOrderNumbers = new Map<string, [number]>();
    for (let [i, name] of iteratorUtils.enumerate(chapterStatuses.keys())) {
      this.progressBar.setTaskInfo(`Чтение главы '${name}' с диска...`);
      this.progressBar.setValue(i, chapterStatuses.size);

      let fragments: Fragment[] = await fsUtils.readJsonFile(
        paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
      );
      chapterFragments.set(name, fragments);
      allChapterFragmentsCount += fragments.length;
      chapterMaxOrderNumbers.set(name, [1]);
    }
    this.progressBar.setDone();

    this.progressBar.setIndeterminate();
    this.progressBar.setTaskInfo(`Поиск файлов...`);
    let filePaths: string[] = [];
    for (let jsonDir of ['data', 'extension']) {
      for await (let path of fsUtils.findFilesRecursively(
        paths.join('assets', jsonDir),
      )) {
        if (path.endsWith('.json')) {
          filePaths.push(paths.join(jsonDir, path));
          this.progressBar.setTaskInfo(`Найдено файлов: ${filePaths.length}`);
        }
      }
    }
    filePaths.sort();
    this.progressBar.setDone();

    for (let [i, filePath] of filePaths.entries()) {
      this.progressBar.setTaskInfo(filePath);
      this.progressBar.setValue(i, filePaths.length);

      let isLangFile = filePath.startsWith(paths.normalize('data/lang/'));
      if (isLangFile && !filePath.endsWith('.en_US.json')) continue;

      let data = await fsUtils.readJsonFile(paths.join('assets', filePath));

      let iterator = isLangFile
        ? findStringsInLangFileObject((data as { labels: unknown }).labels, [
            'labels',
          ])
        : findLangLabelsInObject(data);

      let chapterName = getChapterNameOfFile(filePath);
      let thisChapterFragments = chapterFragments.get(chapterName)!;
      let chapterMaxOrderNumber = chapterMaxOrderNumbers.get(chapterName)!;

      for (let langLabel of iterator) {
        if (isLangLabelIgnored(langLabel, filePath)) continue;

        let jsonPathStr = langLabel.jsonPath.join('/');
        let fragment = thisChapterFragments.find(
          ({ original: o }) =>
            o.file === filePath && o.jsonPath === jsonPathStr,
        );
        if (fragment == null) {
          throw new Error(`${filePath} ${jsonPathStr}: unknown fragment`);
        }
        fragment.orderNumber = chapterMaxOrderNumber[0];
        chapterMaxOrderNumber[0] += 1;
      }
    }
    this.progressBar.setDone();

    let fixedFragmentsCount = 0;

    for (let chapterStatus of chapterStatuses.values()) {
      let chapterName = chapterStatus.name;
      this.progressBar.setTaskInfo(chapterName);
      let fragments = chapterFragments.get(chapterName)!;
      let chapterId = chapterStatus.id;

      fragments.sort((f1, f2) => f1.orderNumber - f2.orderNumber);

      for (let f of fragments) {
        this.progressBar.setValue(
          fixedFragmentsCount,
          allChapterFragmentsCount,
        );
        console.log(
          `${chapterName}: ${f.original.file} ${f.original.jsonPath} ${f.orderNumber}`,
        );
        await this.notaClient.editFragmentOriginal(
          chapterId,
          f.id,
          f.orderNumber,
          f.original.rawContent,
        );
        fixedFragmentsCount++;
      }
    }
    this.progressBar.setDone();

    this.progressBar.setTaskInfo('');
  }

  public async downloadTranslations(force: boolean): Promise<void> {
    try {
      this.progressBar.setTaskInfo('Скачивание данных о главах на Ноте...');
      this.progressBar.setIndeterminate();

      let statuses: ChapterStatuses = await this.notaClient.fetchAllChapterStatuses();
      let prevStatuses: ChapterStatuses = await this.readChapterStatuses();

      await fs.promises.mkdir(CHAPTER_FRAGMENTS_DIR, { recursive: true });

      let chaptersWithUpdates: ChapterStatus[] = [];
      let chaptersWithoutUpdates: ChapterStatus[] = [];
      for (let status of statuses.values()) {
        let prevStatus = prevStatuses.get(status.name);
        let needsUpdate =
          prevStatus == null ||
          status.modificationTimestamp !== prevStatus.modificationTimestamp;
        (force || needsUpdate
          ? chaptersWithUpdates
          : chaptersWithoutUpdates
        ).push(status);
      }

      let chapterFragments = new Map<string, Fragment[]>();

      for (let [i, { name }] of chaptersWithoutUpdates.entries()) {
        console.log(`loading ${name} from disk`);
        this.progressBar.setTaskInfo(`Чтение главы '${name}' с диска...`);
        this.progressBar.setValue(i, chaptersWithoutUpdates.length);

        let fragments: Fragment[] = await fsUtils.readJsonFile(
          paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
        );
        chapterFragments.set(name, fragments);
      }

      for (let [i, status] of chaptersWithUpdates.entries()) {
        let { name } = status;
        console.log(`downloading ${name}`);
        this.progressBar.setTaskInfo(`Скачивание главы '${name}' с Ноты...`);
        this.progressBar.setValue(i, chaptersWithUpdates.length);

        let fragments: Fragment[] = [];

        let {
          total: notaPageCount,
          iterator,
        } = this.notaClient.createChapterFragmentFetcher(status);
        console.log('notaPageCount', notaPageCount);
        await asyncUtils.limitConcurrency(
          (function* () {
            for (let promise of iterator) {
              yield promise.then((pageFragments) => {
                fragments = fragments.concat(pageFragments);
              });
            }
          })(),
          8,
        );

        fragments.sort((f1, f2) => f1.orderNumber - f2.orderNumber);
        chapterFragments.set(name, fragments);

        await fsUtils.writeJsonFile(
          paths.join(CHAPTER_FRAGMENTS_DIR, `${name}.json`),
          fragments,
        );
      }

      let packer = new LocalizeMePacker();
      let packedFragmentsCount = 0;
      let allChapterFragmentsCount = 0;
      for (let fragments of chapterFragments.values()) {
        allChapterFragmentsCount += fragments.length;
      }
      for (let [name, fragments] of chapterFragments.entries()) {
        console.log(`generating packs for ${name}`);
        this.progressBar.setTaskInfo(
          `Генерация транслейт-паков Localize Me для главы '${name}'...`,
        );

        for (let fragment of fragments) {
          this.progressBar.setValue(
            packedFragmentsCount,
            allChapterFragmentsCount,
          );
          await packer.addNotaFragment(fragment);
          packedFragmentsCount++;
        }
      }

      let mappingTable: Record<string, string> = {};

      await fs.promises.mkdir(LOCALIZE_ME_PACKS_DIR, { recursive: true });

      let totalPackCount = packer.packs.size;
      let currentPackIndex = 0;
      for (let [originalFile, packContents] of packer.packs.entries()) {
        mappingTable[originalFile] = originalFile;
        this.progressBar.setTaskInfo(
          `Запись транслейт-пака '${originalFile}'...`,
        );
        this.progressBar.setValue(currentPackIndex, totalPackCount + 1);
        currentPackIndex++;
        await fs.promises.mkdir(
          paths.join(LOCALIZE_ME_PACKS_DIR, paths.dirname(originalFile)),
          { recursive: true },
        );
        await fsUtils.writeJsonFile(
          paths.join(LOCALIZE_ME_PACKS_DIR, originalFile),
          packContents,
        );
      }

      this.progressBar.setTaskInfo(
        `Запись таблицы маппингов транслейт-паков...`,
      );
      this.progressBar.setValue(totalPackCount, totalPackCount + 1);
      await fsUtils.writeJsonFile(LOCALIZE_ME_MAPPING_FILE, mappingTable);

      await this.writeChapterStatuses(statuses);

      console.log('DONE');
      this.progressBar.setTaskInfo('Скачивание переводов успешно завершено!');
      this.progressBar.setDone();
    } catch (err) {
      console.error('err', err);
      this.progressBar.setTaskError(err);
    }
  }

  public async readChapterStatuses(): Promise<ChapterStatuses> {
    let data: ChapterStatusesObj | null = await fsUtils.readJsonFileOptional(
      CHAPTER_STATUSES_FILE,
    );
    return new Map<string, ChapterStatus>(
      data != null ? Object.entries(data) : [],
    );
  }

  public async writeChapterStatuses(statuses: ChapterStatuses): Promise<void> {
    let data: ChapterStatusesObj = {};
    for (let [k, v] of statuses) data[k] = v;
    await fsUtils.writeJsonFile(CHAPTER_STATUSES_FILE, data);
  }
}

function showDevTools(): Promise<void> {
  return new Promise((resolve) =>
    // eslint-disable-next-line no-undefined
    nw.Window.get().showDevTools(undefined, () => resolve()),
  );
}

class ProgressBar {
  public element = document.getElementById(
    'settings_translations_progress',
  )! as HTMLProgressElement;
  public taskElement = document.getElementById(
    'settings_translations_progressTask',
  )!;
  public taskErrorElement = document.getElementById(
    'settings_translations_progressTask_error',
  )!;
  public countElement = document.getElementById(
    'settings_translations_progressCount',
  )!;

  public setTaskInfo(info: { toString(): string }): void {
    this.taskErrorElement.style.display = 'none';
    this.taskElement.textContent = info.toString();
  }

  public setTaskError(err: { toString(): string }): void {
    this.taskErrorElement.style.display = 'inline';
    this.taskElement.textContent = err.toString();
    this.setDone();
  }

  public setIndeterminate(): void {
    this.element.removeAttribute('value');
    this.countElement.textContent = '';
  }

  public setValue(value: number, total: number): void {
    this.element.value = value;
    this.element.max = total;
    let percentStr = ((value / total) * 100).toFixed();
    this.countElement.textContent = `${percentStr}% (${value} / ${total})`;
  }

  public setDone(): void {
    this.element.value = 0;
    this.countElement.textContent = '';
  }
}

interface LocalizableStringData {
  jsonPath: string[];
  langUid: number | null;
  text: string;
}

function* findStringsInLangFileObject(
  obj: unknown,
  jsonPath: string[] = [],
): Generator<LocalizableStringData> {
  if (obj == null) return;

  if (typeof obj === 'string') {
    yield { jsonPath, langUid: null, text: obj };
  } else if (miscUtils.isObject(obj)) {
    for (let key in obj) {
      if (miscUtils.hasKey(obj, key)) {
        yield* findStringsInLangFileObject(obj[key], [...jsonPath, key]);
      }
    }
  }
}

function* findLangLabelsInObject(
  obj: unknown,
  jsonPath: string[] = [],
): Generator<LocalizableStringData> {
  if (!miscUtils.isObject(obj)) return;

  if (miscUtils.hasKey(obj, 'en_US')) {
    if (typeof obj.en_US !== 'string') {
      throw new Error(`Invalid LangLabel at ${jsonPath.join('/')}`);
    }
    let text = obj.en_US;

    let langUid: number | null = null;
    if (miscUtils.hasKey(obj, 'langUid')) {
      if (typeof obj.langUid !== 'number') {
        throw new Error(`Invalid LangLabel at ${jsonPath.join('/')}`);
      }
      langUid = obj.langUid;
    }

    yield { jsonPath, langUid, text };
    return;
  }

  for (let key in obj) {
    if (miscUtils.hasKey(obj, key)) {
      yield* findLangLabelsInObject(obj[key], [...jsonPath, key]);
    }
  }
}

function isLangLabelIgnored(
  langLabel: LocalizableStringData,
  filePath: string,
): boolean {
  switch (langLabel.text.trim()) {
    case '':
    case 'en_US':
    case 'LOL, DO NOT TRANSLATE THIS!':
    case 'LOL, DO NOT TRANSLATE THIS! (hologram)':
    case '\\c[1][DO NOT TRANSLATE THE FOLLOWING]\\c[0]':
    case '\\c[1][DO NOT TRANSLATE FOLLOWING TEXTS]\\c[0]':
      return true;
  }

  let jsonPathStr = langLabel.jsonPath.join('/');

  if (
    /^data\/credits\/.+\.json/.test(filePath) &&
    /^entries\/[^/]+\/names\/\d+$/.test(jsonPathStr)
  ) {
    return true;
  }

  return false;
}
