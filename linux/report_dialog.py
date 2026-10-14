"""Native review → draft → explicit approval/assessment in authenticated WebKit."""
import json
from gi.repository import Gtk
from capture_report import capture_input

class ReportDialog:
    def __init__(self,client):
        self.client=client;self.input=capture_input(client.session);self.project=None;self.draft=None
        self.window=Gtk.Dialog(title='Сводка записи',transient_for=client.window,modal=True)
        self.window.set_default_size(900,700)
        box=self.window.get_content_area();box.set_spacing(8);box.set_border_width(12)
        self.label=Gtk.Label(label='Просмотрите текст. Только эти выдержки отправятся модели; снимки останутся здесь.')
        self.label.set_line_wrap(True);box.pack_start(self.label,False,False,0)
        self.tasks=Gtk.ComboBoxText();box.pack_start(self.tasks,False,False,0)
        self.stack=Gtk.Stack();scroll=Gtk.ScrolledWindow();scroll.add(self.stack);box.pack_start(scroll,True,True,0)
        review=Gtk.Box(orientation=Gtk.Orientation.VERTICAL,spacing=12);self.buffers=[]
        for index,excerpt in enumerate(self.input['excerpts']):
            title=Gtk.Label(label=f'Фрагмент {index+1}');title.set_xalign(0);review.pack_start(title,False,False,0)
            entry=Gtk.TextView();entry.set_wrap_mode(Gtk.WrapMode.WORD_CHAR);entry.set_size_request(-1,150)
            entry.get_buffer().set_text(excerpt['text']);self.buffers.append(entry.get_buffer());review.pack_start(entry,False,False,0)
        self.stack.add_named(review,'review')
        self.text=Gtk.TextView();self.text.set_wrap_mode(Gtk.WrapMode.WORD_CHAR);self.text.set_editable(False)
        self.stack.add_named(self.text,'summary');self.stack.set_visible_child_name('review')
        self.send=Gtk.Button(label='Создать черновик сводки');self.send.set_sensitive(False)
        self.send.connect('clicked',self.summarize);box.pack_start(self.send,False,False,0)
        self.approve=Gtk.Button(label='Утвердить отчёт и оценить 2×3');self.approve.set_sensitive(False)
        self.approve.connect('clicked',self.assess);box.pack_start(self.approve,False,False,0)
        self.window.add_button('Закрыть',Gtk.ResponseType.CLOSE)
        self.window.connect('response',lambda *a:self.window.destroy());self.window.show_all()
        client.api('/api/me',None,self.me_loaded)

    def me_loaded(self,data,error):
        if error:self.label.set_text(error);return
        self.project=data['user']['workspaceId']
        self.client.api('/api/tasks?scope=mine',None,self.tasks_loaded,self.project)

    def tasks_loaded(self,data,error):
        if error:self.label.set_text(error);return
        for task in data['tasks']:self.tasks.append(task['id'],task['title'])
        self.tasks.set_active(0);self.send.set_sensitive(bool(data['tasks']))
        if not data['tasks']:self.label.set_text('Создайте свою задачу в кабинете, затем откройте сводку ещё раз.')

    def summarize(self,*unused):
        for excerpt,buf in zip(self.input['excerpts'],self.buffers):excerpt['text']=buf.get_text(buf.get_start_iter(),buf.get_end_iter(),True).strip()
        self.input['excerpts']=[e for e in self.input['excerpts'] if e['text']]
        if not self.input['excerpts']:self.label.set_text('Оставьте хотя бы одну выдержку для сводки.');return
        self.task_id=self.tasks.get_active_id();self.send.set_sensitive(False);self.tasks.set_sensitive(False);self.text.set_editable(False)
        self.label.set_text('Готовится сводка по подписке. Запрос принят один раз…')
        self.client.api(f'/api/tasks/{self.task_id}/capture',self.input,self.summarized,self.project)

    def summarized(self,data,error):
        if error:self.label.set_text(error);return
        self.draft=data
        (self.client.session/'summary-receipt.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
        report=data['content']
        self.stack.set_visible_child_name('summary')
        self.text.get_buffer().set_text(report['goal']+'\n\nРезультат\n'+report['result']['text']+'\n\nДействия\n'+'\n'.join('• '+a['text'] for a in report['actions'])+'\n\nОграничения\n'+'\n'.join('• '+x for x in report['limitations']))
        meta=data['metadata']
        self.label.set_text(f"Черновик сохранён. {meta['returnedModel']} · расход: {str((meta.get('usage') or {}).get('input_tokens','?'))+' входящих / '+str((meta.get('usage') or {}).get('output_tokens','?'))+' исходящих токенов'}. Цена вызова по подписке не сообщается. Проверьте результат перед утверждением.")
        self.approve.set_sensitive(True)

    def assess(self,*unused):
        self.approve.set_sensitive(False);self.label.set_text('Отчёт утверждается; затем шесть отдельных оценок. Без автоматических повторов.')
        self.client.api(f"/api/reports/{self.draft['report']['id']}/approve",{},self.approved,self.project)

    def approved(self,data,error):
        if error:self.label.set_text(error);return
        self.client.api(f'/api/tasks/{self.task_id}/assess',{'reportId':self.draft['report']['id']},self.assessed,self.project)

    def assessed(self,data,error):
        if error:self.label.set_text(error);return
        (self.client.session/'assessment-receipt.json').write_text(json.dumps(data,ensure_ascii=False,indent=2))
        self.label.set_text(f"Оценка: {data['validCount']} из {data['totalCount']} ответов прошли проверку. Финансовый учёт не изменён. Подробности в задаче кабинета.")
        agg=data['aggregate']
        self.text.get_buffer().set_text('Сводная оценка\n\n'+f"Категория: {agg.get('category') or 'не определена'}\nКвалификация: {agg.get('qualification') or 'не определена'}\nТипичные часы: {agg.get('hoursLow','?')}–{agg.get('hoursHigh','?')}\nЦена труда: {str(agg.get('costLow')/100)+'–'+str(agg.get('costHigh')/100)+' '+str(agg.get('currency')) if agg.get('priceStatus')=='known' else 'не определена'}.\n\nЭто рекомендация ИИ. Доли и финансовые записи не изменены.")
