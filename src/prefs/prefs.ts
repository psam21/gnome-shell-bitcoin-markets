import Adw from '@girs/adw-1';
import Gtk from '@girs/gtk-4.0';
import Pango from '@girs/pango-1.0';
import { ExtensionBase } from '@gnome-shell/extensions/extension';
import { ExtensionPreferences } from '@gnome-shell/extensions/prefs';
import { registerGObjectClass } from '../gjs';

import * as Format from '../format/Format';
import { getProvider, Providers } from '../providers';

import * as BaseProviderConfigView from './BaseProviderConfigView';

const { RegisteredComboBoxView: ComboBoxView, makeConfigRow } = BaseProviderConfigView;
import { ConfigModel, RegisteredIndicatorCollectionModel as IndicatorCollectionModel } from './IndicatorCollectionModel';
import { GettextFunc } from './gettext';

type PreferencesGroupWithWidgetAdd = Adw.PreferencesGroup & {
  add(child: Gtk.Widget): void;
};

export interface ComboBoxOptions {
  value: string;
  label: string;
  active: boolean;
}

function getMarginAll(v: number) {
  return {
    margin_start: v,
    margin_top: v,
    margin_end: v,
    margin_bottom: v,
  };
}

class IndicatorConfigView {
  public widget: Gtk.Box;
  private _indicatorConfig: ConfigModel;
  private _layoutIndicatorSettings: Gtk.Box;
  private _layoutProviderSettings: Gtk.Box;
  private _apiConfigView?: BaseProviderConfigView.BaseProviderConfigView;

  constructor(private gettext: GettextFunc, indicatorConfig: ConfigModel) {
    const margin = 8;

    this._indicatorConfig = indicatorConfig;

    this.widget = new Gtk.Box({
      orientation: Gtk.Orientation.VERTICAL,
    });

    {
      const frame = new Gtk.Frame({
        label: this.gettext('Indicator Settings'),
        ...getMarginAll(margin),
      });
      this._layoutIndicatorSettings = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        ...getMarginAll(margin),
      });
      frame.set_child(this._layoutIndicatorSettings);
      this.widget.append(frame);
    }
    {
      const frame = new Gtk.Frame({
        label: this.gettext('Provider Settings'),
        ...getMarginAll(margin),
      });
      this._layoutProviderSettings = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        ...getMarginAll(margin),
      });
      frame.set_child(this._layoutProviderSettings);
      this.widget.append(frame);
    }

    this._addIndicatorSettings();

    this._selectApi(indicatorConfig.get('api'));
  }

  _addIndicatorSettings() {
    const layout = this._layoutIndicatorSettings;
    layout.append(this._confFormat());
    layout.append(this._confShowChange());
    layout.append(this._confProvider());
  }

  _selectApi(api) {
    const widget = this._layoutProviderSettings;
    const config = this._indicatorConfig;

    if (this._apiConfigView) {
      this._apiConfigView.destroy();
      this._apiConfigView = undefined;
    }

    try {
      this._apiConfigView = new BaseProviderConfigView.BaseProviderConfigView(this.gettext, api, widget, config);
    } catch (e: any) {
      e.message = `Error creating configView for api ${api}: ${e.message}`;
      console.error(e);
    }
  }

  destroy() {
    if (this._apiConfigView) {
      this._apiConfigView.destroy();
      this._apiConfigView = undefined;
    }
  }

  _confFormat(): Gtk.Widget {
    const format = this._indicatorConfig.get('format');

    const entry = new Gtk.Entry({
      text: format,
      tooltip_markup: Format.tooltipText(this.gettext),
    });

    entry.connect('changed', () => {
      this._indicatorConfig.set('format', entry.text);
    });

    return makeConfigRow(this.gettext('Format'), entry);
  }

  _confProvider(): Gtk.Widget {
    const preset = this._indicatorConfig.get('api');

    const options: ComboBoxOptions[] = Object.keys(Providers).map((name) => ({
      value: name,
      label: getProvider(name).apiName,
      active: false,
    }));

    options.forEach((o) => {
      if (o.value === preset) {
        o.active = true;
      }
    });

    const view = new ComboBoxView(options);

    view.connect('changed', (view, api) => this._selectApi(api));

    return makeConfigRow(this.gettext('Provider'), view.widget);
  }

  _confShowChange(): Gtk.Widget {
    const preset = this._indicatorConfig.get('show_change') !== false;

    const switchView = new Gtk.Switch({ active: preset });

    switchView.connect('notify::active', (obj) => {
      this._indicatorConfig.set('show_change', obj.active);
    });

    return makeConfigRow(this.gettext('Show Change'), switchView);
  }

  _confShowBaseCurrency(): Gtk.Widget {
    const preset = this._indicatorConfig.get('show_base_currency') === true;

    const switchView = new Gtk.Switch({ active: preset });

    switchView.connect('notify::active', (obj) => {
      this._indicatorConfig.set('show_base_currency', obj.active);
    });

    return makeConfigRow(this.gettext('Show Base Currency'), switchView);
  }
}

class BitcoinMarketsSettingsWidget extends Gtk.Box {
  private gettext: GettextFunc;
  private _store?: InstanceType<typeof IndicatorCollectionModel>;
  private _configLayout?: Gtk.Box;
  private _listBox?: Gtk.ListBox;
  private _toolbar?: Gtk.Box;
  private _delButton?: Gtk.Button;
  private _indicatorConfigView: IndicatorConfigView | null = null;

  constructor(ext: ExtensionBase) {
    super({
      orientation: Gtk.Orientation.HORIZONTAL,
    });

    this.gettext = ext.gettext.bind(ext);
    this._store = new IndicatorCollectionModel(ext.getSettings());

    /* sidebar (left) */

    const sidebar = new Gtk.Box({
      margin_start: 10,
      margin_end: 10,
      margin_top: 10,
      margin_bottom: 10,
      orientation: Gtk.Orientation.VERTICAL,
      width_request: 240,
    });

    sidebar.append(this._getListBox());
    sidebar.append(this._getToolbar());

    this.append(sidebar);

    /* config (right) */

    this._configLayout = new Gtk.Box({
      // margin: 10,
      orientation: Gtk.Orientation.HORIZONTAL,
      hexpand: true,
      vexpand: true,
    });

    this.append(this._configLayout);

    /* behavior */

    this._listBox!.connect('row-selected', this._onRowSelected.bind(this));
  }

  _getToolbar(): Gtk.Box {
    const toolbar = (this._toolbar = new Gtk.Box({}));

    /* new widget button with menu */
    const newButton = new Gtk.Button({ icon_name: 'list-add-symbolic' });
    newButton.connect('clicked', this._addClicked.bind(this));
    toolbar.append(newButton);

    /* delete button */
    const delButton = (this._delButton = new Gtk.Button({ icon_name: 'list-remove-symbolic' }));
    delButton.connect('clicked', this._delClicked.bind(this));
    toolbar.append(delButton);

    this._updateToolbar();

    return toolbar;
  }

  _getListBox(): Gtk.ListBox {
    this._listBox = new Gtk.ListBox({
      selection_mode: Gtk.SelectionMode.SINGLE,
      hexpand: false,
      vexpand: true,
    });

    // Populate from store
    this._rebuildListBox();

    return this._listBox;
  }

  _rebuildListBox() {
    // Clear existing rows
    let child = this._listBox!.get_first_child();
    while (child) {
      const next = child.get_next_sibling();
      this._listBox!.remove(child);
      child = next;
    }

    // Rebuild from store
    let [res, iter] = this._store!.get_iter_first();
    let index = 0;
    while (res) {
      const label = String(this._store!.get_value(iter, this._store!.Columns.LABEL));
      const row = this._createListBoxRow(label, index);
      this._listBox!.append(row);
      res = this._store!.iter_next(iter);
      index++;
    }
  }

  _createListBoxRow(label: string, index: number): Gtk.ListBoxRow {
    const row = new Gtk.ListBoxRow({
      selectable: true,
      activatable: false,
    });

    const box = new Gtk.Box({
      orientation: Gtk.Orientation.HORIZONTAL,
      spacing: 6,
      margin_start: 6,
      margin_end: 6,
      margin_top: 4,
      margin_bottom: 4,
    });

    // Up button
    const upButton = new Gtk.Button({
      icon_name: 'go-up-symbolic',
      sensitive: index > 0,
      tooltip_text: 'Move up',
      has_frame: true,
    });
    upButton.connect('clicked', () => this._moveRowUp(index));
    box.append(upButton);

    // Label
    const labelWidget = new Gtk.Label({
      label: label,
      xalign: 0,
      hexpand: true,
      ellipsize: Pango.EllipsizeMode.END,
    });
    box.append(labelWidget);

    // Down button
    const downButton = new Gtk.Button({
      icon_name: 'go-down-symbolic',
      sensitive: true, // Will be updated after all rows created
      tooltip_text: 'Move down',
      has_frame: true,
    });
    downButton.connect('clicked', () => this._moveRowDown(index));
    box.append(downButton);

    row.set_child(box);
    return row;
  }

  _updateListBoxButtons() {
    let child = this._listBox!.get_first_child();
    let index = 0;
    while (child) {
      const box = child.get_child();
      if (box) {
        const upButton = box.get_first_child();
        const downButton = box.get_last_child();
        if (upButton instanceof Gtk.Button) {
          upButton.set_sensitive(index > 0);
        }
        if (downButton instanceof Gtk.Button) {
          const nextSibling = child.get_next_sibling();
          downButton.set_sensitive(!!nextSibling);
        }
      }
      child = child.get_next_sibling();
      index++;
    }
  }

  _moveRowUp(index: number) {
    if (index <= 0) return;

    const path = new Gtk.TreePath([index]);
    const iter = this._store!.get_iter(path);
    if (!iter) return;

    const prevPath = new Gtk.TreePath([index - 1]);
    const prevIter = this._store!.get_iter(prevPath);
    if (!prevIter) return;

    this._store!.swap(iter, prevIter);
    // Explicitly persist to GSettings (swap may not reliably emit rows-reordered)
    this._store!.persistOrder();
    this._rebuildListBox();
    // Re-select the moved row
    const newRow = this._listBox!.get_row_at_index(index - 1);
    if (newRow) {
      this._listBox!.select_row(newRow);
    }
  }

  _moveRowDown(index: number) {
    const path = new Gtk.TreePath([index]);
    const iter = this._store!.get_iter(path);
    if (!iter) return;

    const nextPath = new Gtk.TreePath([index + 1]);
    const nextIter = this._store!.get_iter(nextPath);
    if (!nextIter) return;

    this._store!.swap(iter, nextIter);
    // Explicitly persist to GSettings (swap may not reliably emit rows-reordered)
    this._store!.persistOrder();
    this._rebuildListBox();
    // Re-select the moved row
    const newRow = this._listBox!.get_row_at_index(index + 1);
    if (newRow) {
      this._listBox!.select_row(newRow);
    }
  }

  _onRowSelected(_listBox: Gtk.ListBox, row: Gtk.ListBoxRow | null) {
    if (row) {
      const index = row.get_index();
      const path = new Gtk.TreePath([index]);
      const iter = this._store!.get_iter(path);
      if (iter) {
        this._showIndicatorConfig(this._store!.getConfig(iter));
      }
    } else {
      this._showIndicatorConfig(null);
    }
    this._updateToolbar();
  }

  _addClicked() {
    this._store!.append();
    this._rebuildListBox();
    this._updateToolbar();
  }

  _delClicked() {
    const row = this._listBox!.get_selected_row();
    if (!row) {
      return;
    }

    const index = row.get_index();
    const path = new Gtk.TreePath([index]);
    const iter = this._store!.get_iter(path);
    if (iter) {
      this._store!.remove(iter);
    }

    this._rebuildListBox();
    this._updateToolbar();
  }

  destroyView() {
    this._indicatorConfigView?.destroy();
    this._indicatorConfigView = null;
  }
}

const RegisteredBitcoinMarketsSettingsWidget = registerGObjectClass(
  BitcoinMarketsSettingsWidget,
);

export default class BitcoinMarketsSettings extends ExtensionPreferences {
  fillPreferencesWindow(window: Adw.PreferencesWindow): void {
    const page = new Adw.PreferencesPage();
    const gtkWidget = new RegisteredBitcoinMarketsSettingsWidget(this);

    const group = new Adw.PreferencesGroup();
    (group as PreferencesGroupWithWidgetAdd).add(gtkWidget);
    page.add(group);

    window.connect('close-request', () => {
      gtkWidget.destroyView();
      return false;
    });

    window.add(page);
  }
}
